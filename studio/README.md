# Studio

The Sanity Studio for the roofing lab: the schema the office team fills in. The types are `project` (one entry per finished job, with the story, before, during and after photos, video, a customer review and the photo release), `service`, `material`, `neighbourhood`, `business` and `aiRun` (the record of what the AI step did).

```sh
cd studio
npm install
npm run dev        # local Studio on http://localhost:3333
npm run deploy     # hosted Studio on your own sanity.studio address
```

`sanity.cli.ts` carries this lab's project id, studio host name and app id. They are identifiers, not secrets, but they are mine: for your own project replace those three values with yours (the host name must be unique on sanity.studio; leave out `appId` the first time and `sanity deploy` creates one). The site and the tools read the project id and token from environment variables instead (see `tools/_env.mjs` in the repository root).

The free Sanity plan has two roles, Administrator and Viewer. See `docs/HANDOVER.md` for what that means for who can publish.
