# Верстак

Пошаговые 3D-схемы ферм и шпаргалки (жители, зелья, советы) для Minecraft Java 26.3.
Работает в браузере и офлайн, ставится на телефон как приложение (PWA).

**Открыть:** https://gusenichka709.github.io/verstak/
На телефоне: меню браузера → «Установить приложение» / «Добавить на главный экран».

## Как устроено
- `index.html`, `app.js` — интерфейс; `engine.js` — 3D (three.js); `blocks.js` — блоки и мобы, текстуры рисуются кодом.
- `farms/<id>.js` — одна ферма = один файл, порядок в `farms/index.js`.
- `cheats/*.js` — шпаргалки.
- `sw.js` — офлайн-кэш. После изменений подними `VERSION` в `sw.js` и добавь новые файлы в `FILES`.
- Сборки нет: это обычные файлы, GitHub Pages отдаёт их как есть.

## Лицензии сторонних частей
- three.js — MIT (`vendor/three/LICENSE`).
- Шрифты Tiny5 и Golos Text — SIL Open Font License.

Неофициальный фанатский гайд. NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
