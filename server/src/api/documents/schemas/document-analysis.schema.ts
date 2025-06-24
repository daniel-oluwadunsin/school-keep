import { Prop, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { DBSchema, TimestampMixin } from 'src/shared/schemas/db.schema';
import { Document } from './document.schema';

@DBSchema()
export class DocumentAnalysis extends TimestampMixin {
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Document.name, unique: true, required: true })
  document: Document;

  @Prop({ required: true })
  schoolId: string;

  @Prop({ enum: ['queued', 'processing', 'ready', 'failed'], default: 'queued' })
  status: string;

  @Prop()
  error?: string;

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  pages: Record<string, any>[];

  @Prop({ enum: ['linked', 'review', 'none'], default: 'none' })
  matchStatus: string;

  @Prop()
  matchedStudentId?: string;

  @Prop()
  matricNumber?: string;

  @Prop()
  documentType?: string;

  @Prop()
  typeConfidence?: number;

  @Prop({ default: false })
  visualIndexed: boolean;

  @Prop()
  reviewedBy?: string;
}

export type DocumentAnalysisRecord = HydratedDocument<DocumentAnalysis>;
export const DocumentAnalysisSchema = SchemaFactory.createForClass(DocumentAnalysis);
