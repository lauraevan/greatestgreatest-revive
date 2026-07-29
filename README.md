# Greatest Greatest Unblocked

A big browser-games site — thousands of games in one place.

**Play:** https://raw.githack.com/lauraevan/greatestgreatest-revive/main/index.html

---

## ➕ Add a game (the easy way)

You don't have to touch the giant catalog. Open **[`custom-games.js`](custom-games.js)**
and add **one line**:

```js
window.CUSTOM_GAMES = [
    ["My Games", "https://user.github.io/coolgame/index.html", "", "Cool Game"],
];
```

Each line is:

```
["Source", "Game URL", "Icon", "Game name", opensInNewTab]
```

| Field | What it is |
|-------|------------|
| **Source** | The group it appears under in the filter. Use an existing one (`Original`, `gn-math`, …) or invent your own (`My Games`) and it becomes a new filter option. |
| **Game URL** | A full link like `https://user.github.io/game/index.html`, **or** a local loader page in this repo like `library/game.html`. |
| **Icon** | `icons/foo.png` for a picture, or `""` for a plain name tile. |
| **Game name** | The title shown on the card. |
| **opensInNewTab** | *Optional.* Add `, true` at the end **only** for games that refuse to load embedded — they'll open in a new tab instead. |

Commit the change and the game shows up automatically — there's no build step.

### Example (a game hosted on GitHub Pages)

```js
window.CUSTOM_GAMES = [
    ["Original", "https://lauraevan.github.io/Eaglercraftx-1.21.9-src/docs/index.html", "icons/1.8.8.png", "Eaglercraft 1.8.8 retextured"],
];
```

---

## Files

| File | What it is |
|------|------------|
| `index.html` | The site itself. |
| `games-data.js` | The main game catalog (thousands of games). |
| `custom-games.js` | **Your** added games — start here. |
| `library/` | Self-hosted game loader pages. |
| `icons/` | Game cover images. |
| `sw.js` / `manifest.webmanifest` | Make the site installable and fast (PWA). |
