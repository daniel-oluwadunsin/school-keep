import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DocumentService } from './document.service';
import {
  CreateDocumentDto,
  CreateFolderDto,
  GetAllDocumentsQuery,
  MoveDocumentDto,
  UpdateDocumentDto,
} from './dtos';
import { Auth, RolesDec } from 'src/core/decorators/auth.decoractor';
import { Student } from '../student/schemas/student.schema';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MULTER_DISK_STORAGE } from 'src/shared/constants';
import { User } from '../user/schemas/user.schema';
import { MongoIdPipe } from 'src/core/pipes/mongo-id.pipe';
import { Response } from 'express';
import { FileService } from 'src/shared/services/file.service';
import { DocumentResearchService } from './document-research.service';
import { Roles } from '../user/enums';

@Controller('document')
@ApiTags('document')
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly fileService: FileService,
    private readonly researchService: DocumentResearchService,
  ) {}

  @Get('search')
  async search(
    @Auth() user: User,
    @Query('q') query: string,
    @Query('mode') mode: 'keyword' | 'semantic' | 'visual' | 'hybrid' = 'hybrid',
    @Query('limit') limit = '20',
  ) {
    return this.researchService.search(user, query, mode, Math.min(100, Math.max(1, Number(limit) || 20)));
  }

  @RolesDec([Roles.Admin])
  @Post('imports')
  @UseInterceptors(FilesInterceptor('files', 50, { storage: MULTER_DISK_STORAGE }))
  async importDocuments(@UploadedFiles() files: Express.Multer.File[], @Auth() user: User) {
    return this.documentService.importDocuments(files, user);
  }

  @RolesDec([Roles.Admin])
  @Post('backfill')
  async backfill(@Auth() user: User) {
    return { data: await this.researchService.backfill(user), success: true };
  }

  @RolesDec([Roles.Admin])
  @Get('review')
  async reviewQueue(@Auth() user: User) {
    return { data: await this.researchService.listReview(user), success: true };
  }

  @Get('types')
  async documentTypes(@Auth() user: User) {
    return { data: await this.researchService.listTypes(user), success: true };
  }

  @RolesDec([Roles.Admin])
  @Get('training-export')
  async trainingExport(@Auth() user: User) {
    return { data: await this.researchService.exportTrainingData(user), success: true };
  }

  @RolesDec([Roles.Admin])
  @Post('types')
  async createDocumentType(@Auth() user: User, @Body('name') name: string) {
    return { data: await this.researchService.createType(user, name), success: true };
  }

  @Get(':document_id/analysis')
  async getAnalysis(@Param('document_id', MongoIdPipe) documentId: string, @Auth() user: User) {
    return { data: await this.researchService.getAnalysis(documentId, user), success: true };
  }

  @RolesDec([Roles.Admin])
  @Post(':document_id/review')
  async reviewAnalysis(
    @Param('document_id', MongoIdPipe) documentId: string,
    @Auth() user: User,
    @Body() body: { studentId?: string; documentType?: string },
  ) {
    return { data: await this.researchService.review(documentId, user, body), success: true };
  }

  @RolesDec([Roles.Admin])
  @Post(':document_id/reprocess')
  async reprocess(@Param('document_id', MongoIdPipe) documentId: string, @Auth() user: User) {
    await this.researchService.getAnalysis(documentId, user);
    return this.researchService.enqueue(documentId);
  }

  @Get('file/:resource_id')
  async getLocalFile(
    @Param('resource_id') resourceId: string,
    @Auth() user: User,
    @Res() res: Response,
  ) {
    const mediaType = await this.documentService.authorizeResource(resourceId, user);
    const file = await this.fileService.readLocalResource(resourceId);
    res.type(mediaType || 'application/octet-stream').send(file);
  }

  @Post('folder')
  async createFolder(
    @Body() body: CreateFolderDto,
    @Auth('student') student: Student,
  ) {
    return await this.documentService.createFolder(body, student._id);
  }

  @Get('folder')
  @ApiQuery({ name: 'studentId', required: false })
  async getFolders(
    @Auth() user: User,
    @Query('studentId') studentId?: string,
  ) {
    return await this.documentService.getStudentFolders(
      user.student?._id || studentId,
      user,
    );
  }

  @Delete('folder/:folder_id')
  async deleteFolder(@Param('folder_id') folderId: string, @Auth() user: User) {
    return await this.documentService.deleteFolder(folderId, user);
  }

  @Put('folder/:folder_id')
  async updateFolder(
    @Param('folder_id') folderId: string,
    @Body() body: CreateFolderDto,
    @Auth() user: User,
  ) {
    return await this.documentService.updateFolder(body, folderId, user);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: MULTER_DISK_STORAGE }))
  async createDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateDocumentDto,
    @Auth() user: User,
  ) {
    body.file = file;

    return await this.documentService.createDocument(
      body,
      user,
    );
  }

  @Put(':document_reference')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: MULTER_DISK_STORAGE }))
  async updateDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UpdateDocumentDto,
    @Auth() user: User,
    @Param('document_reference') reference: string,
  ) {
    if (file) {
      body.file = file;
    }

    return await this.documentService.updateDocument(body, reference, user._id, user);
  }

  @Get('folder/:folder_id/documents')
  async getFolderDocuments(
    @Param('folder_id', MongoIdPipe) folderId: string,
    @Auth() user: User,
  ) {
    return await this.documentService.getDocuments(
      { folder_id: folderId },
      user,
    );
  }

  @Delete(':document_id')
  async deleteDocument(@Param('document_id', MongoIdPipe) documentId: string, @Auth() user: User) {
    return await this.documentService.deleteDocument(documentId, user);
  }

  @Post(':document_id/move')
  async moveDocumentFolder(
    @Param('document_id', MongoIdPipe) documentId: string,
    @Body() moveDocumentDto: MoveDocumentDto,
    @Auth() user: User,
  ) {
    return await this.documentService.moveDocumentFolder(
      documentId,
      moveDocumentDto.folder_id,
      user,
    );
  }

  @Get()
  async getAllDocuments(
    @Query() query: GetAllDocumentsQuery,
    @Auth() user: User,
  ) {
    return await this.documentService.getDocuments(
      {
        ...query,
        school_id: user?.school?._id,
      },
      user,
    );
  }

  @Get('student/:student_id')
  async getStudentDocuments(
    @Query() query: GetAllDocumentsQuery,
    @Param('student_id', MongoIdPipe) student_id: string,
    @Auth() user: User,
  ) {
    return await this.documentService.getDocuments(
      { ...query, student_id },
      user,
    );
  }

  @Get('download/:document_id')
  async downloadFile(
    @Param('document_id', MongoIdPipe) documentId: string,
    @Auth() user: User,
    @Res() res: Response,
  ) {
    return await this.documentService.downloadFile(res, documentId, user);
  }

  @Get(':document_id')
  async getDocument(
    @Param('document_id', MongoIdPipe) documentId: string,
    @Auth() user?: User,
  ) {
    return await this.documentService.getDocument(documentId, user);
  }
}
