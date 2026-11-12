/**
 * Runtime asset table (standalone package). The fighter model ships in public/models and is
 * loaded relative to the page, so the build runs on any static host.
 */
export const FIGHTERS_MODEL = {
  url: `${import.meta.env.BASE_URL}models/fighters.glb`,
  local: `${import.meta.env.BASE_URL}models/fighters.glb`,
} as const
