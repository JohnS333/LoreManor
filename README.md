This is a extract software to events from Discord, In-game and livestreams and convert them into ordered dated descriptioned events with an intuitive UI

It is a System that Automatically Extract clippable moments from livestreams , and save them as events that happened with the mp4 for each clip
Ideally keeping everything in chronological order to make it VERY EASY to allocate these into storyline videos

This is a frontend that is hooked up to a directory in windows.

## Project Structure

- `client/` contains the React 19 and Vite frontend.
- `server/` contains the Node.js and Express API.
- `shared/` contains types and contracts used by both applications.

The frontend and API are independent npm workspaces. The Vite development server proxies `/api`
requests to Express on port `3001`.

## Development

Install dependencies and start both applications:

```powershell
npm install
npm run dev
```

The frontend is available at `http://localhost:5173`. The API is available at
`http://localhost:3001/api`.

## Other Commands

```powershell
npm run build
npm run lint
```


# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
