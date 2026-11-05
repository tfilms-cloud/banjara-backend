import { Router } from 'express';
import * as serviceCatalogController from '../controllers/serviceCatalog.controller';

const router = Router();

/** Active catalog for customers / provider signup */
router.get('/', serviceCatalogController.listActive);

export default router;
