# Имя проекта (можно поменять)
PROJECT_NAME := fee-app

# Docker Compose бинарь (если у тебя установлен как плагин: docker compose, а не docker-compose)
COMPOSE := docker compose

# --------------------------
# Основные команды
# --------------------------

## Сборка и запуск всего стека (app + redis)
up:
	@echo "🚀 Запускаем приложение и Redis..."
	$(COMPOSE) up --build -d

## Сборка и запуск прод-стека
up-prod:
	@echo "🚀 Запускаем прод-версию (app + redis)..."
	$(COMPOSE) -f docker-compose.prod.yml up --build -d

## Остановка контейнеров (но не удаление томов)
down:
	@echo "🛑 Останавливаем контейнеры..."
	$(COMPOSE) down

## Полное удаление: контейнеры + сеть + тома
clean:
	@echo "🧹 Полностью чистим окружение (включая Redis данные)..."
	$(COMPOSE) down -v

## Пересборка приложения без остановки Redis
rebuild:
	@echo "🔄 Пересобираем только приложение..."
	$(COMPOSE) build app
	$(COMPOSE) up -d app

# --------------------------
# Удобные утилиты
# --------------------------

## Логи приложения
logs:
	@echo "📜 Логи приложения:"
	$(COMPOSE) logs -f app

## Логи Redis
logs-redis:
	@echo "📜 Логи Redis:"
	$(COMPOSE) logs -f redis

## Подключение в shell к приложению
sh-app:
	@echo "🔧 Заходим внутрь контейнера приложения..."
	$(COMPOSE) exec app sh

## Подключение в Redis CLI
sh-redis:
	@echo "🔧 Открываем redis-cli..."
	$(COMPOSE) exec redis redis-cli

## Проверка статуса контейнеров
ps:
	$(COMPOSE) ps

# --------------------------
# Хелп (описание команд)
# --------------------------

## Показывает список доступных команд
help:
	@echo "Доступные команды:"
	@echo "  make up         - собрать и поднять весь стек (app + redis)"
	@echo "  make up-prod    - Сборка и запуск прод-стека"
	@echo "  make down       - остановить контейнеры"
	@echo "  make clean      - полностью удалить всё (контейнеры + тома)"
	@echo "  make rebuild    - пересобрать только приложение"
	@echo "  make logs       - показать логи приложения"
	@echo "  make logs-redis - показать логи Redis"
	@echo "  make sh-app     - открыть shell внутри контейнера приложения"
	@echo "  make sh-redis   - открыть redis-cli внутри контейнера Redis"
	@echo "  make ps         - показать статус контейнеров"
