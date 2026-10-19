上传 API
上传 API 支持通过第三方上传文件至 CloudFlare ImgBed，便于集成到各种应用和服务中。

基本信息
端点：/upload
完整路径： `https://img.0525.eu/upload`
方法：POST
认证：上传认证码或 API Token（需要 upload 权限）
内容类型：multipart/form-data


响应格式

```
[
  {
    "src": "/file/abc123_image.jpg",
    "publicUrl": "https://img.0525.eu/abc123_image.jpg"
  }
]
```
上传成功响应为数组，常见字段如下：

字段名	类型	说明
src	string	文件访问路径。默认不包含域名，如 /file/abc123_image.jpg；使用 returnFormat=full 时返回当前站点完整链接
publicUrl	string	可选。普通上传、分块合并成功时，若已在系统设置 -> 网页设置 -> 全局设置 -> 默认 URL 前缀设置了默认的 URL 前缀，则返回该前缀拼接文件 ID 的公开访问链接
普通上传
直接通过 /upload 端点上传文件，适用于小文件。

参数
Query 参数：

参数名	类型	必需	默认值	说明
authCode	string	否	-	上传认证码(这里是图床的认证码,实际实施时可以与AIGC画廊共用同一个认证码)
uploadChannel	string	否	telegram	上传渠道：telegram、cfr2 (需要选这个)、s3、discord、huggingface、webdav
serverCompress	boolean	否	true	服务端压缩（仅 Telegram 渠道图片）
autoRetry	boolean	否	true	失败时自动切换渠道重试
uploadNameType	string	否	default	命名方式：default（前缀_原名）、index（仅前缀）、origin（仅原名）、short（短链接）
returnFormat	string	否	default	返回格式：default（/file/id）、full（完整链接）
uploadFolder	string	否	-	上传目录，相对路径，如 aigc/poster


Body 参数（FormData）：

参数名	类型	必需	说明
file	File	是	要上传的文件
示例
```
curl -X POST 'https://your.domain/upload?authCode=YOUR_CODE&uploadChannel=telegram' \
  -F 'file=@"/path/to/image.jpg"'
```

文件大小限制

Cloudflare Pages 部署：单次请求体上限 100MB
Telegram 渠道：单文件上限 20MB（超过自动服务端分片）
Discord 渠道：免费 10MB / Nitro 25MB
HuggingFace 渠道：普通上传走后端代理，受 CF Workers CPU 时间限制，建议大文件使用直传方式（见下文）