# 实名认证增量部署

上传压缩包至服务器 `/root/`，解压至独立目录，再执行：

```bash
sudo bash /root/openelf-identity-package/deploy/identity/install.sh
```

目标服务 `openelf-api`，目标目录 `/opt/openelf-api`，环境文件 `/etc/openelf-api.env`。安装前校验源码锚点、配置是否填写，备份原代码与依赖清单；失败恢复原代码并重启。不会修改私有环境配置，不调用收费核验，不包含任何密钥。新增数据库表保留。安装依赖需要 npm 网络访问。

如果公网仅转发 `/api/v1/auth/` 或支付路径，需要在现有 HTTPS server 块添加：

```nginx
location /api/v1/identity/ {
    client_max_body_size 6m;
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 90s;
}
```

先执行 `nginx -t`，通过后重载对应的 Nginx 服务。公网未登录访问 `/api/v1/identity/status` 应返回401 JSON；这只能证明路由可用，不能证明阿里云已开通、密钥有效或权限正确。最终需更新 App，并由用户在 App 中授权和提交真实证件联调。
