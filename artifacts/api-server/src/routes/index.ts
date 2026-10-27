import { Router, type IRouter } from "express";
import cronRouter from "./cron";
import healthRouter from "./health";
import permitCentralRouter from "./permitCentral";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cronRouter);
router.use(permitCentralRouter);

export default router;
