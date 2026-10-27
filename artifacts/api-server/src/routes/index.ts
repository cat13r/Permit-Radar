import { Router, type IRouter } from "express";
import healthRouter from "./health";
import permitCentralRouter from "./permitCentral";

const router: IRouter = Router();

router.use(healthRouter);
router.use(permitCentralRouter);

export default router;
