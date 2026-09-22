import { Router } from 'express';
import * as hotelController from '../controllers/hotel.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { validate } from '../middleware/validation.middleware';
import { createRoomSchema, updateRoomSchema } from '../validators/room.validator';

const router = Router();

router.get('/hotel/:hotelId', hotelController.listRooms);
router.get('/:id', hotelController.getRoom);
router.post('/', authenticate, requireRole('provider'), validate(createRoomSchema), hotelController.createRoom);
router.put('/:id', authenticate, requireRole('provider'), validate(updateRoomSchema), hotelController.updateRoom);
router.delete('/:id', authenticate, requireRole('provider'), hotelController.deleteRoom);

export default router;
