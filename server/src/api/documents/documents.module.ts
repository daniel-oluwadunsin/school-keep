import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Document, DocumentSchema } from './schemas/document.schema';
import { Folder, FolderSchema } from './schemas/folders.schema';
import { SchoolModule } from '../school/school.module';
import { StudentModule } from '../student/student.module';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import { SharedModule } from 'src/shared/shared.module';
import { DocumentAnalysis, DocumentAnalysisSchema } from './schemas/document-analysis.schema';
import { DocumentType, DocumentTypeSchema } from './schemas/document-type.schema';
import { DocumentResearchService } from './document-research.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Document.name,
        schema: DocumentSchema,
      },
      {
        name: Folder.name,
        schema: FolderSchema,
      },
      { name: DocumentAnalysis.name, schema: DocumentAnalysisSchema },
      { name: DocumentType.name, schema: DocumentTypeSchema },
    ]),
    forwardRef(() => SchoolModule),
    forwardRef(() => StudentModule),
    forwardRef(() => SharedModule),
  ],
  controllers: [DocumentController],
  providers: [DocumentService, DocumentResearchService],
  exports: [MongooseModule, DocumentService, DocumentResearchService],
})
export class DocumentModule {}
