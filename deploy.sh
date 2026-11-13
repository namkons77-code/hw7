#!/bin/bash
set -e

echo "=========================================="
echo "🚀 [1/4] Docker 및 환경 점검..."
echo "=========================================="
if [ ! -f backend/.env ]; then
    if [ -f /home/ubuntu/backend.env.bak ]; then
        cp /home/ubuntu/backend.env.bak backend/.env
    else
        echo "FOOD_SAFETY_API_KEY=7d20b06f384541b7b714" > backend/.env
    fi
fi
if ! command -v docker &> /dev/null; then
    echo "Docker 설치 진행 중..."
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg lsb-release
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo usermod -aG docker $USER
fi

echo ""
echo "=========================================="
echo "🐳 [2/4] 컨테이너 빌드 및 백그라운드 배포..."
echo "=========================================="
docker compose down || true
docker compose up -d --build

echo ""
echo "=========================================="
echo "🧹 [3/4] 불필요한 이미지 정리..."
echo "=========================================="
docker image prune -f

echo ""
echo "=========================================="
echo "🔍 [4/4] 컨테이너 가동 상태 확인..."
echo "=========================================="
docker compose ps

echo ""
echo "🎉 안심식당 서비스 배포가 성공적으로 완료되었습니다!"
