import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { DBSchema, TimestampMixin } from 'src/shared/schemas/db.schema';

@DBSchema()
export class DocumentType extends TimestampMixin {
  @Prop({ required: true })
  schoolId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: true })
  active: boolean;
}

export type DocumentTypeRecord = HydratedDocument<DocumentType>;
export const DocumentTypeSchema = SchemaFactory.createForClass(DocumentType);
DocumentTypeSchema.index({ schoolId: 1, name: 1 }, { unique: true });
