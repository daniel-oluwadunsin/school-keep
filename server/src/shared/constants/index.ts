import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { tmpdir } from 'os';

export const DEFAULT_IMAGES = {
  profilePicture:
    'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR1H81w4SmKH5DZmIbxU7EB0aMSkNQDoPQA1mRQxf2Y0wMF1NSa7vghbwwKASi1q4NPmNw&usqp=CAU',
};

const uploadTempDir = join(tmpdir(), 'school-keep-uploads');
mkdirSync(uploadTempDir, { recursive: true });

export const MULTER_DISK_STORAGE = diskStorage({
  destination: uploadTempDir,
  filename(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const extension = extname(file.originalname);
    cb(null, `${uniqueSuffix}${extension}`);
  },
});
