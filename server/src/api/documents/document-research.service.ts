import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
  OnModuleInit, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { Model, Types } from 'mongoose';
import { FileService } from 'src/shared/services/file.service';
import { Roles } from '../user/enums';
import { User } from '../user/schemas/user.schema';
import { Student } from '../student/schemas/student.schema';
import { Document } from './schemas/document.schema';
import { DocumentAnalysis } from './schemas/document-analysis.schema';
import { DocumentType } from './schemas/document-type.schema';
import { Folder } from './schemas/folders.schema';

type SearchMode = 'keyword' | 'semantic' | 'visual' | 'hybrid';
type SearchHit = { documentId: string; page: number; score: number; snippet: string };

@Injectable()
export class DocumentResearchService implements OnModuleInit {
  private readonly queue: string[] = [];
  private running = false;
  constructor(
    @InjectModel(Document.name) private readonly documents: Model<Document>,
    @InjectModel(DocumentAnalysis.name) private readonly analyses: Model<DocumentAnalysis>,
    @InjectModel(DocumentType.name) private readonly types: Model<DocumentType>,
    @InjectModel(Student.name) private readonly students: Model<Student>,
    @InjectModel(Folder.name) private readonly folders: Model<Folder>,
    private readonly files: FileService,
  ) {}

  private get mlUrl() {
    return process.env.ML_SERVICE_URL || 'http://127.0.0.1:8001';
  }

  async onModuleInit() {
    const pending = await this.analyses.find({ status: { $in: ['queued', 'processing'] } }).select('document');
    for (const item of pending) this.schedule(String(item.document));
  }

  private schedule(documentId: string) {
    if (!this.queue.includes(documentId)) this.queue.push(documentId);
    if (!this.running) setImmediate(() => void this.drain());
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        await this.process(this.queue.shift()!).catch(() => {});
      }
    } finally {
      this.running = false;
    }
  }

  async enqueue(documentId: string) {
    const document = await this.documents.findById(documentId);
    if (!document) throw new NotFoundException('Document not found');
    const schoolId = await this.schoolIdFor(document);
    await this.analyses.findOneAndUpdate(
      { document: document._id },
      { $set: { schoolId, status: 'queued', error: null } },
      { upsert: true, new: true },
    );
    this.schedule(documentId);
    return { documentId, status: 'queued' };
  }

  private async schoolIdFor(document: Document) {
    if (document.school) return String((document.school as any)?._id || document.school);
    const student = await this.students.findById(document.student).populate('user', 'school');
    const schoolId = (student?.user as User)?.school;
    if (!schoolId) throw new BadRequestException('Document has no school');
    return String((schoolId as any)?._id || schoolId);
  }

  async process(documentId: string) {
    const document = await this.documents.findById(documentId);
    if (!document) return;
    const schoolId = await this.schoolIdFor(document);
    await this.analyses.findOneAndUpdate({ document: document._id },
      { $set: { schoolId, status: 'processing', error: null } }, { upsert: true });
    let source: { path: string; cleanup: () => Promise<void> } | undefined;
    try {
      source = await this.files.processingResource(document.publicId, document.url);
      const response = await axios.post(`${this.mlUrl}/process`, {
        document_id: documentId,
        school_id: schoolId,
        path: source.path,
        media_type: document.mediaType,
        visual: true,
      }, { timeout: 30 * 60 * 1000 });
      const pages = response.data.pages || [];
      const candidates = pages.flatMap((page: any) => page.matricCandidates || []);
      const match = await this.matchStudent(schoolId, candidates);
      const classifications = pages.map((page: any) => page.layout?.classification)
        .filter((item: any) => item?.type);
      const bestType = classifications.sort((a: any, b: any) => b.confidence - a.confidence)[0];
      const configuredType = bestType && await this.types.findOne({
        schoolId, name: bestType.type, active: true,
      });
      if (match.studentId && !document.student) {
        const folder = await this.folders.findOne({ student: match.studentId, folderName: 'Misc' });
        await this.documents.updateOne({ _id: document._id }, {
          $set: { student: new Types.ObjectId(match.studentId),
            ...(folder ? { folder: folder._id } : {}) },
        });
      }
      await this.analyses.updateOne({ document: document._id }, { $set: {
        status: 'ready', pages, visualIndexed: Boolean(response.data.visualIndexed),
        matchStatus: match.studentId || document.student ? 'linked' : 'review',
        matchedStudentId: match.studentId || (document.student ? String(document.student) : null),
        matricNumber: match.matricNumber || null,
        documentType: configuredType && bestType.confidence >= 0.9 ? bestType.type : null,
        typeConfidence: bestType?.confidence || null,
      } });
    } catch (error: any) {
      await this.analyses.updateOne({ document: document._id }, { $set: {
        status: 'failed', error: error?.response?.data?.detail || error.message || 'Processing failed',
      } });
      throw error;
    } finally {
      if (source) await source.cleanup();
    }
  }

  private async matchStudent(schoolId: string, candidates: { value: string; confidence: number }[]) {
    const strong = candidates.filter((candidate) => candidate.confidence >= 0.95);
    const numbers = [...new Set(strong.map((candidate) => candidate.value.replace(/[^A-Z0-9]/g, '')))];
    if (numbers.length !== 1) return {} as { studentId?: string; matricNumber?: string };
    const students = await this.students.aggregate([
      { $addFields: { normalizedMatric: { $toUpper: { $replaceAll: {
        input: { $replaceAll: { input: '$matricNumber', find: '/', replacement: '' } },
        find: '-', replacement: '',
      } } } } },
      { $match: { normalizedMatric: numbers[0] } },
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $match: { 'user.school': new Types.ObjectId(schoolId) } },
      { $limit: 2 },
    ]);
    return students.length === 1
      ? { studentId: String(students[0]._id), matricNumber: students[0].matricNumber }
      : {};
  }

  private async accessible(document: Document, user: User) {
    const schoolId = await this.schoolIdFor(document);
    if (String(user.school?._id || user.school) !== schoolId) throw new ForbiddenException();
    if (user.role === Roles.Student && String(document.student) !== String(user.student?._id || user.student)) {
      throw new ForbiddenException();
    }
  }

  async assertAccess(documentId: string, user: User) {
    const document = await this.documents.findById(documentId);
    if (!document) throw new NotFoundException('Document not found');
    await this.accessible(document, user);
    return document;
  }

  async getAnalysis(documentId: string, user: User) {
    const document = await this.assertAccess(documentId, user);
    return this.analyses.findOne({ document: document._id });
  }

  async review(documentId: string, user: User, body: { studentId?: string; documentType?: string }) {
    if (user.role !== Roles.Admin) throw new ForbiddenException();
    const document = await this.documents.findById(documentId);
    if (!document) throw new NotFoundException('Document not found');
    await this.accessible(document, user);
    const schoolId = await this.schoolIdFor(document);
    const update: Record<string, any> = { reviewedBy: String(user._id) };
    if (body.studentId) {
      const student = await this.students.findById(body.studentId).populate('user', 'school');
      const candidateSchool = (student?.user as User)?.school;
      if (!student || String((candidateSchool as any)?._id || candidateSchool) !== schoolId) {
        throw new BadRequestException('Invalid student');
      }
      const folder = await this.folders.findOne({ student: student._id, folderName: 'Misc' });
      await this.documents.updateOne({ _id: document._id }, { $set: {
        student: student._id, ...(folder ? { folder: folder._id } : {}),
      } });
      update.matchStatus = 'linked';
      update.matchedStudentId = String(student._id);
    }
    if (body.documentType) {
      const type = await this.types.findOne({ schoolId, name: body.documentType, active: true });
      if (!type) throw new BadRequestException('Unknown document type');
      update.documentType = type.name;
      update.typeConfidence = 1;
    }
    return this.analyses.findOneAndUpdate({ document: document._id }, { $set: update }, { new: true });
  }

  async listReview(user: User) {
    if (user.role !== Roles.Admin) throw new ForbiddenException();
    return this.analyses.find({ schoolId: String(user.school?._id || user.school),
      $or: [{ matchStatus: 'review' }, { status: 'failed' }, { documentType: null }] })
      .sort({ updatedAt: -1 }).limit(100).populate('document', 'documentName url mediaType student');
  }

  async listTypes(user: User) {
    return this.types.find({ schoolId: String(user.school?._id || user.school), active: true }).sort({ name: 1 });
  }

  async exportTrainingData(user: User) {
    if (user.role !== Roles.Admin) throw new ForbiddenException();
    const schoolId = String(user.school?._id || user.school);
    const labeled = await this.analyses.find({ schoolId, status: 'ready',
      documentType: { $type: 'string' } }).populate('document', 'publicId mediaType');
    return labeled.flatMap((analysis) => {
      const document = analysis.document as Document;
      if (!this.files.isLocalResource(document.publicId)) return [];
      return analysis.pages.map((page: any) => ({
        documentId: String(document._id), label: analysis.documentType,
        path: this.files.localResourcePath(document.publicId),
        mediaType: document.mediaType, page: page.page, words: page.words,
      }));
    });
  }

  async createType(user: User, name: string) {
    if (user.role !== Roles.Admin) throw new ForbiddenException();
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 100) throw new BadRequestException('Invalid document type');
    return this.types.findOneAndUpdate(
      { schoolId: String(user.school?._id || user.school), name: cleanName },
      { $set: { active: true } }, { upsert: true, new: true },
    );
  }

  async remove(documentId: string) {
    await this.analyses.deleteOne({ document: new Types.ObjectId(documentId) });
    await axios.delete(`${this.mlUrl}/index/${documentId}`, { timeout: 5000 }).catch(() => {});
  }

  async backfill(user: User) {
    if (user.role !== Roles.Admin) throw new ForbiddenException();
    const schoolId = String(user.school?._id || user.school);
    const studentIds = (await this.students.aggregate([
      { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $match: { 'user.school': new Types.ObjectId(schoolId) } },
      { $project: { _id: 1 } },
    ])).map((student) => student._id);
    const documents = await this.documents.find({ $or: [
      { school: new Types.ObjectId(schoolId) }, { student: { $in: studentIds } },
    ] }).select('_id');
    const analyzed = new Set((await this.analyses.find({
      document: { $in: documents.map((d) => d._id) }, status: 'ready',
    }).select('document')).map((a) => String(a.document)));
    const outstanding = documents.filter((document) => !analyzed.has(String(document._id)));
    for (const document of outstanding) await this.enqueue(String(document._id));
    return { queued: outstanding.length };
  }

  async search(user: User, query: string, mode: SearchMode, limit = 20) {
    if (!query?.trim()) throw new BadRequestException('Search query required');
    if (!['keyword', 'semantic', 'visual', 'hybrid'].includes(mode)) throw new BadRequestException('Invalid mode');
    const schoolId = String(user.school?._id || user.school);
    const studentIds = user.role === Roles.Student
      ? [new Types.ObjectId(String(user.student?._id || user.student))]
      : (await this.students.aggregate([
          { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user' } },
          { $unwind: '$user' },
          { $match: { 'user.school': new Types.ObjectId(schoolId) } },
          { $project: { _id: 1 } },
        ])).map((student) => student._id);
    const documents = await this.documents.find({ $or: [
      { school: new Types.ObjectId(schoolId) }, { student: { $in: studentIds } },
    ] }).sort({ version: -1 });
    const latest = [...new Map(documents.reverse().map((doc) => [doc.reference, doc])).values()];
    await this.documents.populate(latest, [
      { path: 'uploadedBy', select: 'firstName lastName profilePicture' },
      { path: 'folder', select: 'folderName level' },
      { path: 'student', select: 'matricNumber user', populate: { path: 'user', select: 'firstName lastName' } },
    ]);
    const byId = new Map(latest.map((doc) => [String(doc._id), doc]));
    let hits: SearchHit[];
    if (mode === 'keyword') {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, 'i');
      const analyses = await this.analyses.find({ document: { $in: latest.map((d) => d._id) } });
      const textById = new Map(analyses.map((a) => [String(a.document), a.pages]));
      hits = latest.flatMap((doc) => {
        const pages = textById.get(String(doc._id)) || [];
        const matched = pages.find((page: any) => pattern.test(page.text || ''));
        return pattern.test(doc.documentName) || matched
          ? [{ documentId: String(doc._id), page: matched?.page || 1,
              score: pattern.test(doc.documentName) ? 2 : 1, snippet: matched?.text?.slice(0, 240) || '' }]
          : [];
      }).slice(0, limit);
    } else {
      try {
        const response = await axios.post(`${this.mlUrl}/search`, {
          school_id: schoolId, allowed_ids: [...byId.keys()], query,
          mode, limit,
        }, { timeout: 120000 });
        hits = response.data.results || [];
      } catch {
        throw new ServiceUnavailableException('Document search models are unavailable');
      }
    }
    return { data: hits.filter((hit) => byId.has(hit.documentId)).map((hit) => ({
      ...hit, document: byId.get(hit.documentId),
    })), success: true };
  }
}
