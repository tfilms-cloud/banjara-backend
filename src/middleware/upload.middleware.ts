import multer from 'multer';
import { AppError } from '../utils/AppError';

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // This is a cheap first pass only: the client-supplied MIME type is not evidence.
    // The authoritative check is a magic-byte sniff of the buffer in uploadImageBuffer().
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
