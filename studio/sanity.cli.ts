import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: '8h27465q',
    dataset: 'production'
  },
  studioHost: 'seabreeze-roofing-lab',
  deployment: {
    appId: 'k55z5876b4gwj0g7rndqgh7d',
    /**
     * Enable auto-updates for studios.
     * Learn more at https://www.sanity.io/docs/studio/latest-version-of-sanity#k47faf43faf56
     */
    autoUpdates: true,
  },
})
