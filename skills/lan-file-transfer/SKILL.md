---
name: lan-file-transfer
description: 把本机文件或文本（报告、笔记、代码）推送到本机的「局域网文件传输」服务，生成手机/其他局域网设备可用的下载链接；服务未启动时会自动按需拉起。当用户说"传到手机""发到我手机""放进共享区""局域网分享这个文件"，或需要在电脑与手机等局域网设备之间互传文件时使用。
version: 1.3.0
origin: custom
display_name: "局域网文件传输"
display_name_en: "LAN File Transfer"
description_zh: "把文件/文本推入局域网共享区并生成下载链接，手机扫码即取"
description_en: "Push files/text to a LAN share service and return download links"
visibility: "public"
---

# 局域网文件传输（agent 操作手册）

服务是零鉴权的纯 REST API（Node.js + Express），agent 用 `curl` 即可完成全部操作。
Windows PowerShell 环境**必须用 `curl.exe`**（`curl` 是 `Invoke-WebRequest` 的别名，参数不兼容）。

## 第 0 步：探测服务（未运行则按需启动）

服务无需常驻，**agent 按需拉起**即可。默认端口 3000，被占用时服务会自动 +1 探测：

```powershell
# 必做：否则 curl.exe 输出里的中文文件名会被按 GBK 解码成乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$proj = '<项目路径>'   # 改成你的安装路径，例如 D:\vibecoding\lan-file-transfer

function Find-LanTransfer {
    # -m 0.3：本机健康检查毫秒级响应；Windows 保留端口段会 hang 满超时，短超时避免扫描拖慢
    foreach ($p in 3000..3010) {
        try {
            $r = curl.exe -s -m 0.3 "http://localhost:$p/health" | ConvertFrom-Json
            if ($r.service -eq 'lan-file-transfer') { return @($p, "http://localhost:$p") }
        } catch {}
    }
    return $null
}

$found = Find-LanTransfer
if (-not $found) {
    # 静默后台启动：Start-Process(ShellExecute) 独立于当前终端管道；
    # cmd 包装设置静默环境变量并把日志重定向到文件，不弹浏览器
    # AUTO_EXIT_MINUTES=5：临时分享场景用完即走，5 分钟后自动关闭
    Start-Process -FilePath 'cmd' -WindowStyle Hidden -WorkingDirectory $proj `
        -ArgumentList '/c "set LAN_TRANSFER_NO_BROWSER=1&& set LAN_TRANSFER_AUTO_EXIT_MINUTES=5&& node server.js > "%TEMP%\lan-transfer-agent.log" 2>&1"'
    # 等待就绪，最多 15 秒（实测冷启动约 0.5~5 秒，取决于端口扫描耗时）
    foreach ($i in 1..30) {
        Start-Sleep -Milliseconds 500
        $found = Find-LanTransfer
        if ($found) { break }
    }
}
if (-not $found) { throw "服务启动失败，查看 %TEMP%\lan-transfer-agent.log 或请用户到 $proj 手动 npm start 排查" }
$port, $base = $found
```

**agent 启动的实例 5 分钟后自动关闭**（`LAN_TRANSFER_AUTO_EXIT_MINUTES=5`），务必告知用户：
1. 扫码打开页面后**尽快下载**，过了窗口期服务会关，链接失效
2. 若还没下完，重新走本步骤拉起即可（已关闭的实例会重启，未关闭的自动复用，无副作用）

## 第 1 步：把二维码放到用户屏幕上（agent 启动时必做）

agent 启动的服务不弹浏览器，改为**由 agent 用内置浏览器工具打开页面**，用户对着电脑屏幕扫码：

```
打开 $base    # 即第 0 步探测到的实际地址（端口被占用时服务会自动 +1，必须用 $base 而不是写死 3000）
```

然后告知用户：页面左侧「连接信息」卡片里就是二维码，按 `Ctrl` + `+` 放大页面后手机扫码即可。

> 若你所在环境没有浏览器工具，就把地址告诉用户自己打开：本机用 `$base`，手机用 `http://<局域网IP>:$port`。

⚠️ 实测踩坑（务必遵守）：

1. **绝对不要把 `qrcode-terminal` 的 ASCII 二维码贴进聊天**——聊天界面行高会把块字符 `█▀▄` 拉伸成非正方形，实测**手机扫不出**。只有浏览器里 canvas 渲染的二维码可靠
2. **不要贴过期二维码**：二维码有效期 = 服务存活期，服务关了就失效
3. **兜底**：让用户直接手输短地址 `http://<局域网IP>:<端口>`（地址很短，手输也快）

> 若服务本来就是用户手动 `npm start` 起的（浏览器已自动打开），跳过本步。

## 操作 1：上传本机文件到共享区

```powershell
curl.exe -s -F "file=@C:\完整路径\报告.pdf" "$base/upload"
```

成功响应（JSON）：

```json
{"success":true,"file":{"originalName":"报告.pdf","filename":"报告.pdf","size":12345}}
```

**`file.filename` 是实际落盘名**（同名文件会自动加 ` (1)`、` (2)` 后缀，不覆盖），后续拼下载链接必须用它，不要用你本地原始文件名。

## 操作 2：把生成的文本直接写入共享区

agent 要交付报告/笔记/代码时，不要长篇贴进聊天，走这里让手机直接取：

1. 用自己的写文件工具把内容写成 UTF-8 临时文件，如 `$env:TEMP\agent-out.md`
2. 上传时用 `;filename=` 指定共享区里的名字（否则会以临时文件名落盘）：

```powershell
curl.exe -s -F "file=@$env:TEMP\agent-out.md;filename=周报.md" "$base/upload"
```

3. 删除临时文件，用响应里的 `file.filename` 拼下载链接（见操作 3）

## 操作 3：生成下载链接

链接规则：`{host}/download?path={URL编码后的落盘名}`

- **本机浏览器打开**：host 用 `http://localhost:$port`
- **手机/其他设备打开**：host 必须用局域网 IP

```powershell
$enc = [uri]::EscapeDataString($filename)   # 中文名必须编码
$lanIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } |
          Select-Object -First 1).IPv4Address.IPAddress
$phoneUrl = "http://${lanIp}:${port}/download?path=$enc"
```

- 链接仅在**同一局域网**内可达；公网/跨网段需要内网穿透，不属于本 skill 范围
- `path` 是文件夹时自动打包 ZIP 下载
- 追加 `&inline=1` 变为浏览器内联预览（图片/PDF 适用）

## 行为约定与避坑

| 事项 | 说明 |
|---|---|
| 同名不覆盖 | 自动加 ` (1)` 后缀；永远以响应 JSON 的 `file.filename` 为准 |
| curl 输出乱码（实测坑） | PowerShell 默认按 GBK 解码 curl.exe 的 stdout，中文文件名会显示为 `鍒嗘瀽...` 乱码。**先执行 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`** 再调 curl（文件落盘本身不受影响，只是读响应会乱） |
| 单文件上限 | 2GB，超限返回 400 |
| 中文文件名 | 支持（服务端按 UTF-8 解码 multipart） |
| 隐藏文件 | 共享区里以 `.` 开头的文件/目录不出现在文件列表 |
| 删除 | 存在 `DELETE /files/{path}` 接口，**仅在用户明确要求删除时才使用** |
| 大文件 | 上传加 `-m 0` 去掉 curl 超时，或后台执行避免阻塞 |
| 自动关闭 | agent 启动的实例默认 5 分钟自动关闭；用户在窗口期内下载完即可，未下完就重新拉起 |

## 完整示例：把分析报告发到手机

```powershell
# 1. 探测服务（见第 0 步），得到 $base 和 $port

# 2. 文本已写到临时文件，指定共享区名字上传
$resp = curl.exe -s -F "file=@$env:TEMP\agent-out.md;filename=分析报告.md" "$base/upload" | ConvertFrom-Json

# 3. 用实际落盘名拼手机可用链接
$enc = [uri]::EscapeDataString($resp.file.filename)
$lanIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
$url = "http://${lanIp}:${port}/download?path=$enc"

# 4. 清理临时文件，把 $url 回复给用户
Remove-Item "$env:TEMP\agent-out.md" -Force
```

回复用户时给出链接，并说明：手机与电脑连同一 Wi-Fi 时浏览器打开即可下载。

## 完整示例 2：把打包好的 APK 给手机安装（临时分享）

```powershell
# 1. 探测/按需启动（第 0 步，含 5 分钟自动关闭），得到 $base、$port
# 2. 推送 APK
$resp = curl.exe -s -F "file=@D:\build\app-release.apk" "$base/upload" | ConvertFrom-Json
# 3. 用内置浏览器工具打开 $base，让用户扫电脑屏幕上的二维码
# 4. 同时把这条直链也贴给用户（手机浏览器可直接输入）：
#    http://<局域网IP>:$port/download?path=$([uri]::EscapeDataString($resp.file.filename))
```

手机扫码 → 打开共享区页面 → 点 APK 下载安装。服务到期自动关闭，无需手动清理。

> 新设备（手机）首次打开页面**无需填写设备名**，会自动使用「设备-XXXX」默认名，可点击左上角设备名自行修改。
