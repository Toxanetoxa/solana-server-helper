# Solana Fee Server MVP Readiness Plan

## 1. Текущее состояние

- **Назначение**: сервис агрегирует несколько Solana RPC, выбирает «лучший» endpoint по latency и рассылает WebSocket-рекомендации о приоритетных комиссиях для режимов `eco` / `balanced` / `aggr`.
- **Архитектура**: Node.js (ESM, TypeScript) + Redis для кеша. Главный цикл в `src/main.ts`, RPC-агрегация (`src/infrastructure/rpc`), доменная логика (`src/domain`), WebSocket-шлюз (`src/infrastructure/ws`).
- **Инфраструктура**: Dockerfile (multi-stage) + docker-compose для dev/prod. CI/CD workflow публикует образ в GHCR и раскатывает docker-compose на VDS по SSH.
- **Наблюдения**:
  - Почти отсутствует логирование (только `console.log`/`error`).
  - Нет тестов и статической проверки на CI.
  - Отсутствуют health-/metrics-эндпоинты, нет системы мониторинга.
  - Чувствительные переменные (RPC ключи, SSH) только в `.env` и GitHub Secrets, но нет их валидации при старте.

## 2. Цели MVP

1. **Надёжная доставка fees-рекомендаций** при нескольких RPC и деградации одного из них.
2. **Прозрачная наблюдаемость**: метрики, логи, алерты на инциденты.
3. **Воспроизводимый деплой** с проверками качества и rollback-планом.
4. **Минимальные эксплуатационные процессы**: документация, runbooks, оповещение о критичных ошибках.

## 3. Gap-анализ и необходимые компоненты

| Область | Текущее состояние | Пробел | Предлагаемое решение |
| --- | --- | --- | --- |
| **Качество кода** | Нет тестов, lint job отключена | Не гарантируется корректность изменений | Настроить линтер и тесты в CI (Vitest + coverage, ESLint)
| **Обработка ошибок** | Разрозненные `try/catch`, нет классификации ошибок | Нет понимания, что считать критичным, нет retries/backoff | Ввести унифицированный error-handler, severity levels, retry-стратегии
| **Логирование** | `console.log` | Нет structured logging, логов в проде не собираем | Добавить библиотеку (pino/winston), JSON-формат, корреляция по запросам
| **Мониторинг** | Отсутствует | Не видим latency, ошибок, нагрузки | Экспорт Prometheus метрик + Grafana дашборд, alert rules
| **Алертинг** | Нет | Команда не знает о падениях | Телеграм-бот/канал + webhook, интеграция с мониторингом
| **Трассировка** | Нет | Сложно понять, какой RPC отработал | Добавить примитивные span/trace identifiers или хотя бы request-id в логи
| **Конфигурация** | `.env`, без валидации | Ошибки конфигурации всплывают только при рантайме | Использовать `zod`/`envalid` для schema validation, fallback-значения
| **Безопасность** | Нет rate limiting, нет secret rotation | Риск утечек и атак | Скрывать чувствительные данные, план ротации токенов
| **CI/CD** | Build → deploy | Нет quality gates, нет staging | Добавить стадии lint/test, окружение staging, мануальный approval для прод
| **Документация** | README | Нет runbooks, нет API спецификации | Подготовить API docs, 운영 инструкции, чек-листы деплоя
| **Нагрузка** | Нет нагрузочного теста | Не знаем, сколько клиентов выдержим | Сценарии load-тестирования (k6 / artillery)

## 4. Предлагаемый MVP-беклог (фазы)

### Фаза A. Надёжность кода

1. **Тестовый фреймворк**: подключить `vitest` (ESM-friendly), конфиг `vitest.config.ts`.
2. **Юнит-тесты**: покрыть `domain/recommendation.ts`, `application/computeRecommendation.ts`, `infrastructure/cache` (работа с JSON).✅
3. **Интеграционные тесты**: мок RPC (nock/msw), проверить `RpcAggregator` + Redis (использовать `redis-mock`/`ioredis-mock`).✅
4. **Static checks**: вернуть job линтера, добавить `pnpm run typecheck` (tsc --noEmit).✅
5. **CI обновить**: lint, unit, integration (strategy: matrix или последовательные job). Build → deploy запускается только после успешных проверок.✅

### Фаза B. Обработка ошибок и устойчивость

1. **Error boundary**: централизованный обработчик в `main.ts` (классы ошибок для RPC/Redis/WS). ✅
2. **Retries/backoff**: для `recentPrioritizationFees`, health probe с экспоненциальной задержкой. ✅
3. **Circuit breaker**: метить проблемные RPC и не бомбить их до истечения таймаута. ✅
4. **Graceful degradation**: fallback значения fee + сигнализация в логи/метрики при `stale` > N секунд. ✅

### Фаза C. Observability

1. **Logging**:
   - Подключить `pino` с sink в STDOUT (JSON).
   - Ввести уровни (`info`, `warn`, `error`), request-id/endpoint-id в каждом событии.
   - Перевести текущие `console.log` на structured logs.
2. **Metrics**:
   - Экспортировать Prometheus метрики с помощью `prom-client`.
   - Метрики: latency RPC, успешность health probe, количество WS клиентов, Cache hit/miss, ошибки по типу.
   - Добавить `/metrics` HTTP endpoint (Express/Fastify mini-сервер или promhttp).
3. **Alerting**:
   - Настроить Prometheus alert rules (например, `rpc_aggregator_unhealthy`, `ws_clients_count` падение, `redis_errors_total` > 0).
   - Telegram notifier: либо бот, слушающий alerts из Prometheus Alertmanager, либо отдельный worker, отправляющий критичные логи.
   - Хранить токены бота в GitHub Secrets / .env.
4. **Crash reporting**: рассмотреть Sentry/Rollbar для stack trace (на CI добавить DSN через secret).

### Фаза D. Операционное сопровождение

1. **Runbooks**: документ «что делать, если...». Примеры: Redis не доступен, RPC деградирует, WS не отвечает.
2. **On-call коммуникация**: Telegram канал/чат, куда падают алерты + ручной бота `/status`.
3. **Release checklist**: шаблон (обновили env? сделан backup Redis? трафик переключён?).
4. **Backups**: для Redis (если используем appendonly — настроить cron snapshot + удалённое хранение).
5. **Staging среда**: поднять `docker-compose` на отдельном сервере/VM, куда подключается QA.

### Фаза E. Функциональные доработки (приоритет MVP)

1. **Расширяемость режимов риска**: вынести конфигурацию CU и коэффициентов в JSON/YAML, чтобы не менять код.
2. **WebSocket API**: добавить версии/схему (напоминание: документировать expected payload, handle unknown command).
3. **Backpressure**: если клиентов > X, ограничивать рассылку и логировать.
4. **Rate limiting для входящих команд** (чтобы не DDOS-или `set_mode`).

### Фаза F. Безопасность

1. **Валидация env через Zod** (`src/config` уже частично делает) — расширить список.
2. **Секреты**: перевести на GitHub Environments (staging/prod), запрет писать секреты в логах.
3. **Audit deps**: настроить Dependabot (GitHub) для npm и GitHub Actions.
4. **Внутренний HTTP сервис (metrics/health)** — защитить basic auth/allowlist.

## 5. Предлагаемые инструменты и интеграции

- **Тесты**: `vitest`, `supertest` (для HTTP метрик), `msw-node` или `nock` для RPC.
- **Quality**: `eslint`, `prettier`, `tsc --noEmit`.
- **Logging**: `pino`, вывод в STDOUT → собирается Docker logging driver → Loki/ELK (позже).
- **Monitoring**: Prometheus + Grafana (deploy via docker-compose, отдельные контейнеры).
- **Alerting**: Alertmanager → Telegram (bot token, chat id). Альтернатива — простой бот на Cloudflare Worker/Serverless.
- **Bot**: небольшой Node.js сервис/cron, читает критичные записи из логов/БД и постит в TG.
- **Error tracking**: Sentry sdk (`@sentry/node`).
- **Load testing**: k6 (JavaScript сценарии), artillery.

## 6. Дорожная карта MVP (6 недель условно)

1. **Неделя 1**: Настроить lint+tests, покрыть домен, обновить CI (quality gate). Добавить env validation.
2. **Неделя 2**: Реализовать structured logging, централизованный error handler, retries/circuit breaker.
3. **Неделя 3**: Добавить Prometheus метрики и `/metrics`. Поднять локально Grafana + алерты.
4. **Неделя 4**: Интегрировать Alertmanager → Telegram, написать runbooks, оформление README секций «Monitoring/Alerting».
5. **Неделя 5**: Сборка staging окружения, smoke-тесты, нагрузочные сценарии.
6. **Неделя 6**: Финальная проверка, checklist, freeze ветки, выкладка в прод.

## 7. Требуемые решения/вопросы к команде

- Какие SLA / SLO нужны (latency, freshness рекомендаций)?
- Нужно ли поддерживать больше 3 уровней риска? Есть ли фронтенд Клиент? Требуются ли REST endpoints?
- Какой объём трафика планируется (сколько клиентов WS)?
- Где будет размещаться monitoring stack (та же VDS или отдельный кластер)?
- Нужно ли хранить историю рекомендаций (для аналитики)? Если да — выбрать БД (Timescale/Postgres).

## 8. Риски

- Redis — single point of failure (нет репликации). Нужен план отказоустойчивости.
- Обновление зависимостей (Node 21 preview). Рекомендация — перейти на LTS (Node 22 LTS после GA).
- Без rate limiting есть риск, что внешний клиент завалит RPC «set_mode»/WS.
- SSH-based деплой без валидации состояния может привести к рассинхронизации compose (планировать Terraform/Ansible в будущем).

## 9. Следующие шаги (кратко)

1. Утвердить список задач по фазам A–F.
2. Назначить ответственных за тесты, observability, CI.
3. Настроить Dev/Stage окружения + секреты.
4. Начать реализацию с quality gate (tests + lint) и structured logging — это фундамент для всех последующих этапов.

---
Документ нужно поддерживать в актуальном состоянии: при завершении задач отражать статус, добавлять новые требования. Это повысит прозрачность и обеспечит готовность сервиса к продакшену.

