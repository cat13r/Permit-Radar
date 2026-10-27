// Vercel serverless entry. vercel.json rewrites every /api/* request here;
// the Express app is prebuilt by `pnpm --filter @workspace/api-server run build`.
export { default } from "../artifacts/api-server/dist/app.mjs";
