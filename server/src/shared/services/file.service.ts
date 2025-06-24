import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { v2, UploadApiOptions, UploadApiResponse } from 'cloudinary';
import { CLOUDINARY_PROVIDER } from '../providers';
import * as mime from 'mime-types';
import { copyFile, mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import axios from 'axios';
import { tmpdir } from 'os';

@Injectable()
export class FileService {
  constructor(
    @Inject(CLOUDINARY_PROVIDER) private readonly cloudinary: typeof v2,
  ) {}

  private get localRoot() {
    return resolve(process.env.LOCAL_STORAGE_DIR || './storage');
  }

  private get localMode() {
    return (process.env.STORAGE_DRIVER || 'local') === 'local';
  }

  isLocalResource(id: string) {
    return /^[a-f0-9-]{36}$/.test(id) && existsSync(join(this.localRoot, id));
  }

  localResourcePath(id: string) {
    if (!this.isLocalResource(id)) throw new BadRequestException('Local file unavailable');
    return join(this.localRoot, id);
  }

  async readLocalResource(id: string): Promise<Buffer> {
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      throw new BadRequestException('Invalid local resource');
    }
    const path = join(this.localRoot, id);
    if (!existsSync(path)) throw new BadRequestException('File not found');
    return readFile(path);
  }

  async processingResource(publicId: string, url: string) {
    if (this.localMode && this.isLocalResource(publicId)) {
      return { path: join(this.localRoot, publicId), cleanup: async () => {} };
    }
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 30 * 1024 * 1024,
    });
    const path = join(tmpdir(), `school-keep-${randomUUID()}`);
    await writeFile(path, Buffer.from(response.data));
    return { path, cleanup: () => unlink(path) };
  }

  async uploadResource(
    file: string,
    isFilePath: boolean = false,
    options: UploadApiOptions = {},
  ): Promise<Pick<UploadApiResponse, 'url' | 'public_id'>> {
    try {
      if (this.localMode) {
        await mkdir(this.localRoot, { recursive: true });
        const id = randomUUID();
        await copyFile(file, join(this.localRoot, id));
        if (isFilePath) await unlink(file);
        return {
          url: `${process.env.PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/document/file/${id}`,
          public_id: id,
        };
      }
      let resource_type: UploadApiOptions['resource_type'] = 'auto';

      if (isFilePath) {
        const mimetype = mime.lookup(file);

        if (mimetype && mimetype.startsWith('image')) {
          resource_type = 'image';
        } else if (mimetype && mimetype.startsWith('video')) {
          resource_type = 'video';
        } else {
          resource_type = 'raw';
        }
      }

      const data = await this.cloudinary.uploader.upload(file, {
        folder: 'school_keep',
        resource_type,
        ...options,
      });

      if (isFilePath) {
        await unlink(file);
      }

      return { url: data.secure_url, public_id: data.public_id };
    } catch (error: any) {
      console.log(error);
      throw new BadRequestException(
        `Unable to upload resource to cloud ${error.message ?? error}`,
      );
    }
  }

  async deleteResource(
    public_id: string,
    options: UploadApiOptions = {},
  ): Promise<void> {
    try {
      if (this.isLocalResource(public_id)) {
        if (/^[a-f0-9-]{36}$/.test(public_id)) {
          await unlink(join(this.localRoot, basename(public_id))).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
        return;
      }
      await this.cloudinary.uploader.destroy(public_id, { ...options });
    } catch (error: any) {
      console.log(error);
      throw new BadRequestException(
        `Unable to delete resource from cloud ${error.message ?? error}`,
      );
    }
  }
}
