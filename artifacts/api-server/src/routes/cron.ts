import { Router, type IRouter } from "express";
import { runScheduledJob } from "../lib/dailyDigests";

const router: IRouter = Router();

// Called by Vercel Cron (see vercel.json), which sends
// "Authorization: Bearer $CRON_SECRET".
router.get("/cron/daily", async (req, res): Promise<void> => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get("authorization") !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  try {
    await runScheduledJob();
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Daily permit workflow failed");
    res.status(500).json({ error: "Daily permit workflow failed." });
  }
});

export default router;
