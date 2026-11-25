This is a extract software to events from Discord, In-game and livestreams and convert them into ordered dated descriptioned events with an intuitive UI

It is a System that Automatically Extract clippable moments from livestreams , and save them as events that happened with the mp4 for each clip
Ideally keeping everything in chronological order to make it VERY EASY to allocate these into storyline videos

This is a frontend ui that hooks directly into your windows folder.

# Data Model and Flow:

- As of 11/22/26 the persistence layer is strictly a folder on windows that contains events.json, channels.json, vods.json and videoID.vtt caption files. that folder alsog contains the mp4 videos that are extracted.

## Data Model and Flow Diagram

The persistence layer is currently a Windows folder containing the JSON data,
caption files, and extracted video clips shown below.

```mermaid
flowchart LR
    subgraph Client
        direction TB
        channelInput["Channels:<br/>{ channelURL }"]
        fetchVods["Channel:<br/>Fetch Vods Button"]
        vods["Vods (frontend data model):<br/>videoID<br/>videoURL<br/>datetime<br/>vod title<br/>thumbnailURL"]
        extractEvents["Extract<br/>Events Button"]
        events["Events (frontend data model):<br/>eventID<br/>sourceType (VOD, manual, Discord)<br/>VOD ID (same as videoID in URL)<br/>datetime<br/>starttime<br/>endtime<br/>Description of the event<br/>trackAllocations: [Story or Devlog]"]
        downloadClip["Video ? directory location : <br/> Download clip button"]

        channelInput --- fetchVods
        fetchVods --> vods
        vods --> extractEvents
        extractEvents --> events
        events --> downloadClip
    end

    subgraph Server["Server (Node.js)"]
        direction TB
        fetchVodData["YT-DLP fetch vods:<br/>check vods.json to see which ones have already been fetched,<br/>then fetch the rest"]
        analyzeVideo["AI API call: analyze this video by accessing [url] or [transcript].<br/><br/>Based on the spoken words, chunk these into moments that denote noteworthy distinct events.<br/>Each event should have:<br/>Event ID and Timestamp<br/>Description of the event"]
        clipper["YT-DLP<br/><br/>clipper.py<br/>parameters: url and timestamps"]
    end

    ytChannel["YT Channel"]

    subgraph Persistence["Persistence"]
        direction TB
        subgraph LoreManor["LoreManor folder on Windows"]
            direction TB
            subgraph ProjectFolder
                direction TB
                eventsJson["events.json"]
                channelsJson["channels.json"]
                vodsJson["vods.json"]
                captions["videoID.vtt caption files"]
                videos["videos/<br/>&quot;&lt;date&gt;_v&lt;eventNumberFromVod&gt;_&lt;ShortDesc&gt;.mp4&quot;"]
            end
        end
    end

    ytChannel --> fetchVodData
    fetchVods --> fetchVodData
    fetchVodData --> vods
    vods --> vodsJson
    extractEvents --> analyzeVideo
    analyzeVideo --> clipper
    events --> eventsJson
    channelInput --> channelsJson
    events -->|On state change| eventsJson
    clipper --> videos
    downloadClip --> clipper
```

### Recommendations

- Use a single canonical schema for frontend state and persisted JSON so field
  names and types cannot drift between the client and server.
- Add stable identifiers and explicit relationships, such as a `channelId` on
  VODs and a `vodId` on events, instead of relying on URLs.
- Store timestamps in one documented format, preferably ISO 8601 in UTC, and
  validate that event start and end times fall within the source VOD.
- Define how concurrent state changes are handled when more than one process
  writes to the Windows folder.
- Consider a small schema version in each JSON file to support future migrations.


## Project Structure

- `client/` contains the React 19 and Vite frontend.
- `server/` contains the Node.js and Express API.
- `shared/` contains types and contracts used by both applications.

The frontend and API are independent npm workspaces. The Vite development server proxies `/api`
requests to Express on port `3001`.

## Main Workspace UI

- The main page has three primary vertical tracks: **Channels**, **VODs**, and
  **Events**. They are independently scrollable and remain usable when additional
  allocation tracks are shown.
- The Events track is ordered chronologically. Events derived from VODs cannot
  be manually reordered. Only events with `sourceType: "manual"` can be
  reordered with drag and drop.
- The Events track can split into allocation tracks. The current allocation
  names are **Story** and **Devlog**, and additional allocation track names may
  be added without changing the track structure.
- Each VOD has an ID-based color shared by its card's left bar, its connector
  lines, and the left bars of its event cards in all allocation tracks.
  Connector lines are clipped to the vertical bounds of the event-card
  scrolling area and fade out over 28 pixels at its top and bottom edges,
  keeping headers and the space below the tracks clear.
- An event may be allocated to both Story and Devlog and may reference one or
  more video projects through `projectAllocations`.
- Video projects are an optional grouping layer. A project has a project type of
  **Storyline** or **Devlog** and contains references to event IDs.
- The initial frontend state is empty until channel information is fetched or
  persistence JSON files exist. The UI must not invent sample channels, VODs,
  events, or projects.
- The Settings dialog stores the active project's absolute Windows directory in
  browser local storage. The directory can be updated or cleared from the same dialog.
- Domain data is persisted through `PUT /api/persistence/:collection`. Supported
  collections map to `channels.json`, `vods.json`, `events.json`,
  `allocation-tracks.json`, and `projects.json` in the active project directory.
  The server validates each payload and replaces JSON files atomically.
- Channels are loaded from `channels.json` when a project directory is selected.
  Adding a channel saves the updated channel list through the persistence API;
  the name is inferred from the URL when possible and may be overridden.
- Use **Fetch VODs** on a channel to retrieve its YouTube streams with `yt-dlp`.
  Full video metadata is fetched so livestream dates are included. New videos
  are merged by video ID into the existing VOD collection and saved through the
  persistence API to `vods.json`; existing VODs are loaded when the project
  directory is selected. Server terminal logs show fetch stages and each VOD
  whose metadata is retrieved. The server requires `yt-dlp` on `PATH`.
- Configure a Gemini API key in **Settings** to enable **Extract events** on
  each VOD. The server fetches English captions with `yt-dlp`, caches them as
  `<videoID>.vtt` in the active project directory, and reuses a non-empty cached
  transcript on later extractions. Gemini-generated events are validated,
  normalized to the shared event schema, merged into `events.json`, and shown
  in the Events track. The API key remains in browser local storage and is sent
  to the server only with an extraction request; it is not written to project
  files or server logs. Event extraction uses `gemini-3.5-flash-lite`, Google's
  high-throughput Flash-Lite model, to keep transcript processing costs low
  while retaining the structured-output capability required by the prompt. The
  server build copies the extraction prompt alongside the compiled application.



# Persistence
Recommended flow:

The server loads JSON when the project directory is selected.
The client holds the loaded data in React state.
User actions update React state immediately.
Completed actions trigger an API save:
Add/remove a channel
Reorder an event
Assign an allocation
Create/update a project
Text editing saves on submit, blur, or with a short debounce.
The server writes atomically using a temporary file followed by rename.


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



# For users

Prerequisites: yt-dlp --update
nodejs