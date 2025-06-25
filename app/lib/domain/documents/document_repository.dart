import 'package:app/shared/network/network_service.dart';

class DocumentRepository {
  final NetworkService networkService;

  DocumentRepository({required this.networkService});

  searchDocuments(String query, String mode) async {
    final response = await networkService.get(
      '/document/search',
      queryParameters: {'q': query, 'mode': mode},
    );
    return response?.data;
  }

  getFolderDocuments(String folderId) async {
    final response =
        await networkService.get("/document/folder/$folderId/documents");

    return response?.data;
  }

  getDocument(String documentId) async {
    final response = await networkService.get("/document/$documentId");

    return response?.data;
  }

  deleteDocument(String documentId) async {
    final response = await networkService.delete("/document/$documentId");

    return response?.data;
  }
}
