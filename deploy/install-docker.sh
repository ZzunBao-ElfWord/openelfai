#!/bin/bash
set -e
# 使用阿里云 Docker CE 镜像源
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/debian buster stable" > /etc/apt/sources.list.d/docker.list
apt-get update -qq 2>&1 | tail -2
apt-get install -y -qq --fix-missing docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>&1 | tail -3
systemctl enable docker
systemctl start docker
docker --version
docker compose version
echo "DOCKER_INSTALL_DONE"
