import { https } from '../configs/http.config';
import {
  CreateDocumentDto,
  GetAllDocumentsQuery,
  UpdateDocumentDto,
} from '../schemas/interfaces';
import { ApiResponse, Document, DocumentAnalysis, Folder, ResearchHit, ResearchMode } from '../schemas/types';
import { errorHandler } from '../utils';

const getAllDocuments = async (query: GetAllDocumentsQuery) => {
  let url = '/document?';

  if (query.folder_id) {
    url = `/document/folder/${query.folder_id}/documents?`;
  }

  if (query.search) {
    url += `search=${query.search}`;
  }

  try {
    const response = await https.get<ApiResponse<Document[]>>(url);

    return response?.data?.data;
  } catch (error) {
    return errorHandler(error);
  }
};

const getStudentFolders = async (studentId: string) => {
  try {
    const response = await https.get<ApiResponse<Folder[]>>(
      `/document/folder?studentId=${studentId}`
    );

    return response?.data?.data;
  } catch (error) {
    return errorHandler(error);
  }
};

const getDocument = async (documentId: string) => {
  try {
    const response = await https.get<
      ApiResponse<Document, { otherVersions: Document[] }>
    >(`/document/${documentId}`);

    return response?.data;
  } catch (error) {
    return errorHandler(error);
  }
};

const updateDocument = async (
  documentReference: string,
  body: UpdateDocumentDto
) => {
  const formData = new FormData();

  if (body.documentName) {
    formData.append('documentName', body.documentName);
  }

  if (body.file) {
    formData.append('file', body.file);
  }

  try {
    const response = await https.put(
      `/document/${documentReference}`,
      formData
    );

    return response?.data;
  } catch (error) {
    return errorHandler(error);
  }
};

const createDocument = async (body: CreateDocumentDto) => {
  const formData = new FormData();

  formData.append('file', body.file!);
  formData.append('documentName', body.documentName);
  formData.append('folder', body.folder);
  formData.append('studentId', body.studentId);

  try {
    const response = await https.post(`/document`, formData, {
      signal: body.abortController?.signal,
      onUploadProgress(progress) {
        if (body.onUploadProgress) {
          const fileSize = progress.total || 1;
          const uploadedFileSize = progress.loaded;
          const uploadPercentage = (uploadedFileSize / fileSize) * 100;

          body.onUploadProgress(Number(uploadPercentage.toFixed(2)));
        }
      },
    });

    return response?.data;
  } catch (error) {
    return errorHandler(error);
  }
};

const getStudentDocuments = async (studentId: string) => {
  try {
    const response = await https.get<ApiResponse<Document[]>>(
      `/document/student/${studentId}`
    );

    return response?.data?.data;
  } catch (error) {
    return errorHandler(error);
  }
};

const search = async (q: string, mode: ResearchMode) => {
  const response = await https.get<ApiResponse<ResearchHit[]>>('/document/search', {
    params: { q, mode },
  });
  return response.data.data;
};

const importScans = async (files: File[]) => {
  const data = new FormData();
  files.forEach((file) => data.append('files', file));
  const response = await https.post('/document/imports', data);
  return response.data;
};

const getReviewQueue = async () => {
  const response = await https.get<ApiResponse<DocumentAnalysis[]>>('/document/review');
  return response.data.data;
};

const getAnalysis = async (documentId: string) => {
  const response = await https.get<ApiResponse<DocumentAnalysis>>(`/document/${documentId}/analysis`);
  return response.data.data;
};

const review = async (documentId: string, body: { studentId?: string; documentType?: string }) => {
  const response = await https.post(`/document/${documentId}/review`, body);
  return response.data;
};

const getTypes = async () => {
  const response = await https.get<ApiResponse<Array<{ _id: string; name: string }>>>('/document/types');
  return response.data.data;
};

const createType = async (name: string) => {
  const response = await https.post('/document/types', { name });
  return response.data;
};

const backfill = async () => {
  const response = await https.post('/document/backfill');
  return response.data;
};

const documentService = {
  getAllDocuments,
  getStudentFolders,
  getDocument,
  updateDocument,
  createDocument,
  getStudentDocuments,
  search,
  importScans,
  getReviewQueue,
  getAnalysis,
  review,
  getTypes,
  createType,
  backfill,
};
export default documentService;
