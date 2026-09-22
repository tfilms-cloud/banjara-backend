import multer from 'multer';
import { AppError } from '../utils/AppError';

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed'));
      return;
    }
    cb(null, true);
  },
});

export function assertImageUpload(file?: Express.Multer.File) {
  if (!file) throw new AppError('Image file is required', 400);
  return file;
}
