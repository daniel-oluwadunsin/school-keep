import { Types } from 'mongoose';
import { DocumentResearchService } from './document-research.service';
import { Roles } from '../user/enums';

describe('document matching', () => {
  const schoolId = String(new Types.ObjectId());

  function serviceWithStudents(students: any[]) {
    const service = Object.create(DocumentResearchService.prototype) as DocumentResearchService;
    (service as any).students = { aggregate: jest.fn().mockResolvedValue(students) };
    return service;
  }

  it('requires high OCR confidence before considering a student', async () => {
    const service = serviceWithStudents([]);
    const result = await (service as any).matchStudent(schoolId, [
      { value: 'SK/CSC/2021/001', confidence: 0.8 },
    ]);
    expect(result).toEqual({});
    expect((service as any).students.aggregate).not.toHaveBeenCalled();
  });

  it('links exactly one matching student', async () => {
    const studentId = new Types.ObjectId();
    const service = serviceWithStudents([{ _id: studentId, matricNumber: 'SK/CSC/2021/001' }]);
    const result = await (service as any).matchStudent(schoolId, [
      { value: 'SK/CSC/2021/001', confidence: 0.99 },
    ]);
    expect(result).toEqual({ studentId: String(studentId), matricNumber: 'SK/CSC/2021/001' });
  });

  it('sends ambiguous matches to review', async () => {
    const service = serviceWithStudents([
      { _id: new Types.ObjectId() }, { _id: new Types.ObjectId() },
    ]);
    const result = await (service as any).matchStudent(schoolId, [
      { value: 'SK/CSC/2021/001', confidence: 0.99 },
    ]);
    expect(result).toEqual({});
  });
});

describe('document search access', () => {
  it('queries only the signed-in student documents', async () => {
    const studentId = new Types.ObjectId();
    const schoolId = new Types.ObjectId();
    const find = jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    const service = Object.create(DocumentResearchService.prototype) as DocumentResearchService;
    (service as any).documents = { find, populate: jest.fn() };
    (service as any).analyses = { find: jest.fn().mockResolvedValue([]) };
    const user = { role: Roles.Student, school: schoolId, student: studentId } as any;

    await service.search(user, 'transcript', 'keyword');

    expect(find).toHaveBeenCalledWith({ student: { $in: [studentId] } });
  });
});
