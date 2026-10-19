import indexHtml from "../public/index.html" with { type: "text" };

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      return json({ error: err.message || "Server Error" }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // ---- 前端页面 ----
  if (method === "GET" && (path === "/" || path === "/index.html")) {
    return new Response(indexHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // ---- 认证校验 ----
  if (path === "/api/verify" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (checkCode(env, body.code)) return json({ ok: true });
    return json({ error: "认证码不正确" }, 401);
  }

  // ---- 文件夹 ----
  if (path === "/api/folders") {
    if (method === "GET") return json({ folders: await getFolders(env) });
    if (method === "POST") return createFolder(request, env);
  }

  let m = path.match(/^\/api\/folders\/([^/]+)$/);
  if (m && method === "DELETE") return deleteFolder(env, m[1], request.headers.get("X-Auth-Code"));

  m = path.match(/^\/api\/folders\/([^/]+)\/images$/);
  if (m && method === "GET") {
    return json({ images: await getImages(env, m[1]) });
  }

  m = path.match(/^\/api\/folders\/([^/]+)\/images\/([^/]+)$/);
  if (m && method === "DELETE") {
    return deleteImage(env, m[1], m[2], request.headers.get("X-Auth-Code"));
  }

  // ---- 上传(原图 / 缩略图) ----
  if (path === "/api/upload" && method === "POST") return upload(request, env);

  // ---- AI 识别 ----
  if (path === "/api/ai-describe" && method === "POST") return aiDescribe(request, env);

  return json({ error: "Not Found" }, 404);
}

// ---------- 认证 ----------

function checkCode(env, code) {
  return !!env.AUTH_KEY && typeof code === "string" && code === env.AUTH_KEY;
}

function unauthorized() {
  return json({ error: "认证码不正确" }, 401);
}

// ---------- KV ----------

async function getFolders(env) {
  const raw = await env.KV.get("folders");
  return raw ? JSON.parse(raw) : [];
}

async function saveFolders(env, folders) {
  await env.KV.put("folders", JSON.stringify(folders));
}

async function getImages(env, folderId) {
  const raw = await env.KV.get(`images:${folderId}`);
  return raw ? JSON.parse(raw) : [];
}

async function saveImages(env, folderId, images) {
  await env.KV.put(`images:${folderId}`, JSON.stringify(images));
}

function refreshCover(folder, images) {
  folder.count = images.length;
  const first = images[0];
  folder.coverUrl = first ? first.url : null;
  folder.coverThumb = first ? first.thumbUrl || first.url : null;
}

// ---------- 文件夹 ----------

async function createFolder(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!checkCode(env, body.code)) return unauthorized();

  const title = (body.title || "").trim();
  if (!title) return json({ error: "标题不能为空" }, 400);
  const description = (body.description || "").trim();

  const folders = await getFolders(env);
  if (folders.some((f) => f.title === title)) {
    return json({ error: "已存在同名文件夹" }, 400);
  }

  const folder = {
    id: crypto.randomUUID(),
    title,
    description,
    createdAt: Date.now(),
    count: 0,
    coverUrl: null,
    coverThumb: null,
  };
  folders.unshift(folder);
  await saveFolders(env, folders);
  return json({ folder });
}

async function deleteFolder(env, folderId, code) {
  if (!checkCode(env, code)) return unauthorized();
  const folders = await getFolders(env);
  const idx = folders.findIndex((f) => f.id === folderId);
  if (idx === -1) return json({ error: "文件夹不存在" }, 404);
  folders.splice(idx, 1);
  await saveFolders(env, folders);
  await env.KV.delete(`images:${folderId}`);
  return json({ ok: true });
}

async function deleteImage(env, folderId, imageId, code) {
  if (!checkCode(env, code)) return unauthorized();
  const folders = await getFolders(env);
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return json({ error: "文件夹不存在" }, 404);

  const images = await getImages(env, folderId);
  const idx = images.findIndex((i) => i.id === imageId);
  if (idx === -1) return json({ error: "图片不存在" }, 404);
  images.splice(idx, 1);

  refreshCover(folder, images);
  await saveImages(env, folderId, images);
  await saveFolders(env, folders);
  return json({ ok: true });
}

// ---------- 图床上传 ----------

const EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

async function uploadToImgbed(env, file, filename, folderId) {
  const fd = new FormData();
  fd.append("file", file, filename);

  const u = new URL(env.IMG_BASE + "/upload");
  u.searchParams.set("authCode", env.IMG_KEY);
  u.searchParams.set("uploadChannel", "cfr2");
  u.searchParams.set("uploadNameType", "origin");
  u.searchParams.set("returnFormat", "full");
  u.searchParams.set("uploadFolder", `aigc/${folderId}`);

  const res = await fetch(u, { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(`图床上传失败 (${res.status})`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || !data[0] || !data[0].src) {
    throw new Error("图床返回格式异常");
  }
  const item = data[0];
  const url = item.publicUrl || env.IMG_BASE + item.src.replace(/^\/file\//, "/");
  return { url };
}

function randSuffix() {
  return Math.random().toString(36).slice(2, 6);
}

async function upload(request, env) {
  const form = await request.formData();
  if (!checkCode(env, form.get("code"))) return unauthorized();

  const folderId = form.get("folderId");
  const folders = await getFolders(env);
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return json({ error: "文件夹不存在" }, 404);

  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "缺少文件" }, 400);

  const images = await getImages(env, folderId);
  const imageId = form.get("imageId");

  if (imageId) {
    // ---- 缩略图:回填已有记录 ----
    const record = images.find((i) => i.id === imageId);
    if (!record) return json({ error: "原图记录不存在" }, 404);
    const { url: thumbUrl } = await uploadToImgbed(env, file, `${imageId}__thumb.jpg`, folderId);
    record.thumbUrl = thumbUrl;
    if (folder.coverUrl === record.url) folder.coverThumb = thumbUrl;
    await saveImages(env, folderId, images);
    await saveFolders(env, folders);
    return json({ imageId, thumbUrl });
  } else {
    // ---- 原图:建记录 ----
    const type = file.type || "image/jpeg";
    const extFromName = (file.name || "").split(".").pop().toLowerCase();
    const ext = EXT_BY_TYPE[type] || (extFromName && extFromName !== file.name ? extFromName : "jpg");
    const id = `${Date.now()}${randSuffix()}`;
    const { url } = await uploadToImgbed(env, file, `${id}.${ext}`, folderId);
    images.unshift({
      id,
      title: (form.get("title") || "").toString().trim() || "未命名",
      description: (form.get("description") || "").toString().trim(),
      prompt: (form.get("prompt") || "").toString().trim(),
      url,
      thumbUrl: null,
      width: Number(form.get("width")) || null,
      height: Number(form.get("height")) || null,
      createdAt: Date.now(),
    });
    refreshCover(folder, images);
    await saveImages(env, folderId, images);
    await saveFolders(env, folders);
    return json({ imageId: id, url, thumbUrl: null });
  }
}

// ---------- AI 识别 ----------

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function aiDescribe(request, env) {
  const form = await request.formData();
  if (!checkCode(env, form.get("code"))) return unauthorized();

  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "缺少文件" }, 400);
  const hint = (form.get("prompt") || "").toString().trim();

  const dataUrl = `data:${file.type || "image/jpeg"};base64,${bufToBase64(await file.arrayBuffer())}`;

  const prompt = [
    "你是图片描述助手。请根据这张图片" + (hint ? `(用户补充提示: ${hint})` : "") + ",输出严格的 JSON,不要输出任何其他内容:",
    '{"title": "简短有力的标题,不超过20个字", "description": "1-3句话描述图片内容、风格或亮点"}',
  ].join("\n");

  const res = await fetch(`${env.AI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.AI_KEY}`,
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return json({ error: `AI 识别失败 (${res.status}): ${text.slice(0, 200)}` }, 502);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  // 容错解析:剥离 ```json 围栏、截取首个 {...}
  const cleaned = content.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  let parsed = {};
  if (start !== -1 && end > start) {
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      parsed = {};
    }
  }
  if (!parsed.title && !parsed.description) {
    return json({ error: "AI 返回内容无法解析" }, 502);
  }
  return json({
    title: (parsed.title || "").toString().trim(),
    description: (parsed.description || "").toString().trim(),
  });
}
