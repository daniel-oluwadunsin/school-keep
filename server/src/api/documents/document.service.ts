import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Document } from './schemas/document.schema';
import {
  FilterQuery,
  Model,
  PipelineStage,
  PopulateOptions,
  Types,
} from 'mongoose';
import { Folder } from './schemas/folders.schema';
import { Department } from '../school/schemas/department.schema';
import { Student } from '../student/schemas/student.schema';
import { isEmpty } from 'lodash';
import {
  CreateDocumentDto,
  CreateFolderDto,
  GetAllDocumentsQuery,
  UpdateDocumentDto,
} from './dtos';
import { FileService } from 'src/shared/services/file.service';
import { v4 } from 'uuid';
import * as mime from 'mime-types';
import { User } from '../user/schemas/user.schema';
import { Roles } from '../user/enums';
import axios from 'axios';
import { Response } from 'express';
import { DocumentResearchService } from './document-research.service';
import { unlink } from 'fs/promises';

@Injectable()
export class DocumentService {
  constructor(
    @InjectModel(Document.name)
    private readonly documentModel: Model<Document>,
    @InjectModel(Folder.name)
    private readonly folderModel: Model<Folder>,
    @InjectModel(Department.name)
    private readonly departmentModel: Model<Department>,
    @InjectModel(Student.name)
    private readonly studentModel: Model<Student>,

    private readonly fileService: FileService,
    private readonly researchService: DocumentResearchService,
  ) {}

  async authorizeResource(resourceId: string, user: User): Promise<string> {
    const document = await this.documentModel.findOne({ publicId: resourceId }).populate({
      path: 'student',
      populate: { path: 'user', select: 'school' },
    });
    if (!document) throw new NotFoundException('Document file not found');
    const student = document.student as Student;
    const studentUser = student?.user as User;
    const schoolId = document.school
      ? String((document.school as any)?._id || document.school)
      : String((studentUser?.school as any)?._id || studentUser?.school);
    const allowed = user.role === Roles.Student
      ? String(student?._id) === String(user.student?._id)
      : schoolId === String(user.school?._id || user.school);
    if (!allowed) throw new ForbiddenException('Document access denied');
    return document.mediaType;
  }

  private async authorizeStudent(studentId: string, user: User) {
    if (user.role === Roles.Student) {
      if (String(user.student?._id || user.student) !== String(studentId)) throw new ForbiddenException();
      return;
    }
    const student = await this.studentModel.findById(studentId).populate('user', 'school');
    if (!student) throw new NotFoundException('Student not found');
    const school = (student.user as User)?.school;
    if (String((school as any)?._id || school) !== String(user.school?._id || user.school)) {
      throw new ForbiddenException();
    }
  }

  private async getDocReference() {
    const reference = v4();

    if (await this.documentModel.findOne({ reference })) {
      return this.getDocReference();
    }

    return reference;
  }

  async initStudentFolders(studentId: string) {
    const student = await this.studentModel
      .findById(studentId)
      .populate('department', 'levelsCount _id');

    if (!student) throw new NotFoundException('Student not found');

    if (!isEmpty(await this.folderModel.find({ student: student._id }))) {
      return;
    }

    const data = [];

    new Array(student.department.levelsCount).fill(null).forEach((_, index) => {
      data.push({
        student: student._id,
        level: index + 1,
        folderName: `${index + 1}00L`,
        isCustom: false,
      });
    });

    data.push({
      student: student._id,
      folderName: 'Misc',
      isCustom: false,
    });

    await this.folderModel.create(data);
  }

  async createFolder(createFolderDto: CreateFolderDto, studentId: string) {
    const data = await this.folderModel.create({
      student: new Types.ObjectId(studentId),
      folderName: createFolderDto.folderName,
      isCustom: true,
    });

    return {
      message: 'Folder created',
      data,
      success: true,
    };
  }

  async getStudentFolders(studentId: string, user?: User) {
    if (user) await this.authorizeStudent(studentId, user);
    const data = await this.folderModel
      .find({
        student: new Types.ObjectId(studentId),
      })
      .select('-student -updatedAt')
      .sort({ level: 1, createdAt: -1 });

    return {
      message: 'Folders fetched successfully',
      data,
    };
  }

  async deleteFolder(folderId: string, user: User) {
    const data = await this.folderModel.findById(folderId);

    if (!data) throw new NotFoundException('Folder not found');
    await this.authorizeStudent(String(data.student), user);
    if (!data.isCustom)
      throw new BadRequestException('Only non-custom folders can be deleted');

    await data.deleteOne();

    const uniquePublicIds: string[] = [];
    const ids: string[] = [];

    await this.documentModel
      .find({
        folder: data._id,
      })
      .then((docs) => {
        docs.forEach((doc) => {
          ids.push(doc._id);
          if (doc.publicId && !uniquePublicIds.includes(doc.publicId)) {
            uniquePublicIds.push(doc.publicId);
          }
        });
      });

    await this.documentModel.deleteMany({
      _id: {
        $in: ids,
      },
    });

    await Promise.all(ids.map((id) => this.researchService.remove(id)));

    await Promise.all(
      uniquePublicIds.map(async (publicId) =>
        this.fileService.deleteResource(publicId),
      ),
    );

    return {
      message: 'Folder deleted successfully',
      success: true,
    };
  }

  async updateFolder(updateFolderDto: CreateFolderDto, folderId: string, user: User) {
    const folder = await this.folderModel.findById(folderId);

    if (!folder) throw new NotFoundException('Folder not found');
    await this.authorizeStudent(String(folder.student), user);
    if (!folder.isCustom)
      throw new BadRequestException('Only non-custom folders can be edited');

    await this.folderModel.findByIdAndUpdate(folderId, updateFolderDto);

    return {
      message: 'Folder updated successfully',
      success: true,
    };
  }

  async createDocument(
    documentDto: CreateDocumentDto,
    user: User,
  ) {
    const folder = await this.folderModel.findById(documentDto.folder);
    if (!folder) throw new NotFoundException('Oops! folder not found');
    const studentId = String(user.student?._id || documentDto.studentId);
    await this.authorizeStudent(studentId, user);
    if (String(folder.student) !== studentId) throw new BadRequestException('Folder does not belong to student');

    const { url, public_id } = await this.fileService.uploadResource(
      documentDto.file.path,
      true,
    );

    const reference = await this.getDocReference();

    const data = await this.documentModel.create({
      documentName: documentDto.documentName,
      folder: folder._id,
      url,
      publicId: public_id,
      version: 1,
      reference,
      uploadedBy: new Types.ObjectId(user._id),
      student: new Types.ObjectId(studentId),
      school: user.school?._id || user.school,
      mediaType:
        mime.lookup(documentDto.file.path) || documentDto.file.mimetype,
    });

    void this.researchService.enqueue(data._id).catch(() => {});

    return {
      message: 'Document created',
      success: true,
      data,
    };
  }

  async importDocuments(files: Express.Multer.File[], user: User) {
    if (!files?.length) throw new BadRequestException('No files uploaded');
    const accepted = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/tiff']);
    const imported = [];
    for (const file of files) {
      if (!accepted.has(file.mimetype) || file.size > 30 * 1024 * 1024) {
        await unlink(file.path).catch(() => {});
        throw new BadRequestException(`Unsupported file: ${file.originalname}`);
      }
      const { url, public_id } = await this.fileService.uploadResource(file.path, true);
      const data = await this.documentModel.create({
        documentName: file.originalname,
        reference: await this.getDocReference(),
        version: 1,
        mediaType: file.mimetype,
        url,
        publicId: public_id,
        school: user.school?._id || user.school,
        uploadedBy: user._id,
      });
      imported.push({ documentId: data._id, ...(await this.researchService.enqueue(data._id)) });
    }
    return { data: imported, success: true, message: 'Documents queued for processing' };
  }

  async getDocuments(query?: GetAllDocumentsQuery, user?: User) {
    const _query: FilterQuery<Document> = {};
    const accessMatch: FilterQuery<Document> = {};
    if (user?.role === Roles.Student) {
      accessMatch.student = new Types.ObjectId(String(user.student?._id || user.student));
    } else if (user?.school) {
      const schoolId = new Types.ObjectId(String(user.school?._id || user.school));
      const students = await this.studentModel.aggregate([
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $match: { 'user.school': schoolId } },
        { $project: { _id: 1 } },
      ]);
      accessMatch.$or = [{ school: schoolId }, { student: { $in: students.map((student) => student._id) } }];
    }

    if (query.folder_id) {
      _query['folder._id'] = new Types.ObjectId(query.folder_id);
      delete query.folder_id;
    }

    if (query.reference) {
      _query['reference'] = query.reference;
      delete query.reference;
    }

    if (query.student_id) {
      _query['student._id'] = new Types.ObjectId(query.student_id);
      delete query.student_id;
    }

    if (query.school_id) {
      const students = await this.studentModel.aggregate([
        {
          $lookup: {
            from: 'users',
            as: 'user',
            localField: 'user',
            foreignField: '_id',
            pipeline: [{ $project: { school: 1 } }],
          },
        },
        {
          $unwind: '$user',
        },
        {
          $match: {
            'user.school': new Types.ObjectId(query.school_id),
          },
        },
        {
          $project: {
            _id: 1,
          },
        },
      ]);

      _query['student._id'] = { $in: students.map((st) => st._id) };
      delete query.school_id;
    }

    let pipelines: PipelineStage[] = [
      { $match: accessMatch },
      {
        $sort: {
          reference: 1,
          version: -1,
        },
      },
      {
        $group: {
          _id: '$reference',
          docFields: { $first: '$$ROOT' },
        },
      },
      {
        $replaceRoot: { newRoot: '$docFields' },
      },
      {
        $lookup: {
          from: 'users',
          as: 'uploadedBy',
          localField: 'uploadedBy',
          foreignField: '_id',
          pipeline: [
            {
              $lookup: {
                from: 'admins',
                as: 'admin',
                localField: '_id',
                foreignField: 'user',
                pipeline: [
                  {
                    $lookup: {
                      from: 'departments',
                      as: 'department',
                      localField: 'department',
                      foreignField: '_id',
                    },
                  },
                  {
                    $unwind: {
                      path: '$department',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                ],
              },
            },
            {
              $unwind: {
                path: '$admin',
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 1,
                firstName: 1,
                lastName: 1,
                profilePicture: 1,
                admin: {
                  _id: 1,
                  permission: 1,
                  department: {
                    name: 1,
                    unionName: 1,
                    logo: 1,
                    _id: 1,
                  },
                },
              },
            },
          ],
        },
      },
      {
        $unwind: {
          path: '$uploadedBy',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: 'folders',
          localField: 'folder',
          foreignField: '_id',
          as: 'folder',
          pipeline: [
            {
              $project: {
                folderName: 1,
                level: 1,
                createdAt: 1,
                _id: 1,
              },
            },
          ],
        },
      },
      {
        $unwind: {
          path: '$folder',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          updatedAt: 0,
          publicId: 0,
        },
      },
      ...(user?.role != Roles.Student
        ? [
            {
              $lookup: {
                from: 'students',
                localField: 'student',
                foreignField: '_id',
                as: 'student',
                pipeline: [
                  {
                    $lookup: {
                      from: 'users',
                      localField: 'user',
                      foreignField: '_id',
                      as: 'user',
                      pipeline: [
                        {
                          $project: {
                            firstName: 1,
                            lastName: 1,
                            profilePicture: 1,
                            email: 1,
                            _id: 1,
                          },
                        },
                      ],
                    },
                  },
                  {
                    $unwind: {
                      path: '$user',
                      preserveNullAndEmptyArrays: true,
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      user: 1,
                      matricNumber: 1,
                    },
                  },
                ],
              },
            },
            {
              $unwind: {
                path: '$student',
                preserveNullAndEmptyArrays: true,
              },
            },
          ]
        : [
            {
              $project: {
                student: 0,
              },
            },
          ]),
      {
        $match: _query,
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
    ];

    if (query.search) {
      const searchRegex = { $regex: query.search, $options: 'i' };
      pipelines = [
        ...pipelines,
        {
          $addFields: {
            'student.user.fullName': {
              $concat: [
                '$student.user.firstName',
                ' ',
                '$student.user.lastName',
              ],
            },
            'student.user.fullNameReversed': {
              $concat: [
                '$student.user.lastName',
                ' ',
                '$student.user.firstName',
              ],
            },
            'uploadedBy.fullName': {
              $concat: ['$uploadedBy.firstName', ' ', '$uploadedBy.lastName'],
            },
            'uploadedBy.fullNameReversed': {
              $concat: ['$uploadedBy.lastName', ' ', '$uploadedBy.firstName'],
            },
          },
        },
        {
          $match: {
            $or: [
              { 'student.user.fullName': searchRegex },
              { 'student.user.fullNameReversed': searchRegex },
              { 'uploadedBy.fullName': searchRegex },
              { 'uploadedBy.fullNameReversed': searchRegex },
              { 'student.matricNumber': searchRegex },
              { documentName: searchRegex },
              { 'folder.folderName': searchRegex },
            ],
          },
        },
        {
          $project: {
            'student.user.fullName': 0,
            'student.user.fullNameReversed': 0,
            'uploadedBy.fullName': 0,
            'uploadedBy.fullNameReversed': 0,
          },
        },
      ];
    }

    const data = await this.documentModel.aggregate(pipelines);

    return {
      message: 'Documents fetched successfully',
      success: true,
      data,
    };
  }

  async updateDocument(
    updateDocumentDto: UpdateDocumentDto,
    reference: string,
    userId: string,
    user: User,
  ) {
    const { file, documentName } = updateDocumentDto;

    const versions = await this.documentModel
      .find({ reference })
      .sort({ version: -1 })
      .limit(1);

    const latestVersion = versions[0];

    if (!latestVersion) throw new NotFoundException('Document not found');
    await this.researchService.assertAccess(latestVersion._id, user);

    const requestData = {
      ...latestVersion.toObject(),
      version: latestVersion.version + 1,
      uploadedBy: new Types.ObjectId(userId),
      id: undefined,
      _id: undefined,
      __v: undefined,
    };

    if (file) {
      const { url, public_id } = await this.fileService.uploadResource(
        file.path,
        true,
      );

      requestData.url = url;
      requestData.publicId = public_id;
      requestData.mediaType =
        mime.lookup(file.path) || file.mimetype || requestData.mediaType;
    }

    if (documentName) {
      requestData.documentName = documentName;
    }

    const data = await this.documentModel.create(requestData);

    void this.researchService.enqueue(data._id).catch(() => {});

    return {
      message: 'Document updated (new version created)',
      success: true,
      data,
    };
  }

  async getDocument(document_id: string, user?: User) {
    if (user) await this.researchService.assertAccess(document_id, user);
    const populateOptions: PopulateOptions[] = [
      {
        path: 'uploadedBy',
        select: 'admin firstName lastName profilePicture',
        populate: {
          path: 'admin',
          select: 'department permission',
          populate: {
            path: 'department',
            select: 'logo unionName name',
          },
        },
      },
      ...(user?.role === Roles.Admin
        ? [
            {
              path: 'folder',
              select: 'folderName level',
            },
            {
              path: 'student',
              select: 'user',
              populate: {
                path: 'user',
                select: 'firstName lastName profilePicture',
              },
            },
          ]
        : []),
    ];

    const selectOptions = '-updatedAt -publicId -student';

    const data = await this.documentModel
      .findById(document_id)
      .populate(populateOptions)
      .select(selectOptions);

    if (!data) throw new NotFoundException('Document not found');

    const otherVersions = await this.documentModel
      .find({
        reference: data.reference,
        _id: { $ne: data._id },
      })
      .populate(populateOptions)
      .select(selectOptions)
      .sort({ version: -1 });

    return {
      message: 'Document fetched',
      data,
      meta: {
        otherVersions,
      },
    };
  }

  async deleteDocument(document_id: string, user: User) {
    const document = await this.documentModel.findById(document_id);

    if (!document) throw new NotFoundException('Document not found');
    await this.researchService.assertAccess(document_id, user);

    const uniquePublicIds: string[] = [];
    const ids: string[] = [];

    await this.documentModel
      .find({
        reference: document.reference,
      })
      .then((docs) => {
        docs.forEach((doc) => {
          ids.push(doc._id);
          if (doc.publicId && !uniquePublicIds.includes(doc.publicId)) {
            uniquePublicIds.push(doc.publicId);
          }
        });
      });

    await this.documentModel.deleteMany({
      _id: {
        $in: ids,
      },
    });
    await Promise.all(ids.map((id) => this.researchService.remove(id)));
    await Promise.all(
      uniquePublicIds.map(async (publicId) =>
        this.fileService.deleteResource(publicId),
      ),
    );

    return {
      message: 'All versions of this document has been deleted',
      success: true,
    };
  }

  async moveDocumentFolder(document_id: string, folder_id: string, user: User) {
    const document = await this.documentModel.findById(document_id);
    if (!document) throw new NotFoundException('Document not found');
    await this.researchService.assertAccess(document_id, user);

    const folder = await this.folderModel.findById(folder_id);
    if (!folder) throw new NotFoundException('Folder not found');
    await this.authorizeStudent(String(folder.student), user);
    if (String(folder.student) !== String(document.student)) throw new BadRequestException('Folder belongs to another student');

    await this.documentModel.updateMany(
      { reference: document.reference },
      {
        $set: {
          folder: folder._id,
        },
      },
    );

    return {
      message: 'Document moved',
      success: true,
    };
  }

  async downloadFile(res: Response, documentId: string, user: User) {
    try {
      const document = await this.documentModel.findById(documentId);
      if (!document) throw new NotFoundException('Document not found');
      await this.authorizeResource(document.publicId, user);
      const fileName = document.documentName.replace(/[\r\n"\\]/g, '_');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName}"`,
      );
      res.setHeader('Content-Type', document.mediaType || 'application/octet-stream');
      if (this.fileService.isLocalResource(document.publicId)) {
        return res.send(await this.fileService.readLocalResource(document.publicId));
      }
      const response = await axios.get(document.url, { responseType: 'stream' });
      response.data.pipe(res);
    } catch (error) {
      if (!res.headersSent) {
        res.status(error?.status || 500).json({ error: error?.message || 'Failed to download file' });
      }
    }
  }
}
