import 'package:app/configs/app_config.dart';
import 'package:app/data/documents/models/document_model.dart';
import 'package:app/domain/documents/document_repository.dart';
import 'package:app/presentation/documents/routes/routes.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class DocumentsSearchScreen extends StatefulWidget {
  const DocumentsSearchScreen({super.key});

  @override
  State<DocumentsSearchScreen> createState() => _DocumentsSearchScreenState();
}

class _DocumentsSearchScreenState extends State<DocumentsSearchScreen> {
  final controller = TextEditingController();
  String mode = 'hybrid';
  bool loading = false;
  String? error;
  List<Map<String, dynamic>> hits = [];

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  Future<void> search() async {
    if (controller.text.trim().isEmpty) return;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final response = await getIt
          .get<DocumentRepository>()
          .searchDocuments(controller.text.trim(), mode);
      if (!mounted) return;
      setState(() {
        hits = List<Map<String, dynamic>>.from(response['data']);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        error = 'Search is unavailable. Please retry.';
      });
    } finally {
      if (mounted) {
        setState(() {
          loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Search documents')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(children: [
          TextField(
            controller: controller,
            decoration: InputDecoration(
              labelText: 'Describe the document',
              suffixIcon:
                  IconButton(icon: const Icon(Icons.search), onPressed: search),
            ),
            onSubmitted: (_) => search(),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: mode,
            decoration: const InputDecoration(labelText: 'Search mode'),
            items: const [
              DropdownMenuItem(value: 'hybrid', child: Text('Hybrid')),
              DropdownMenuItem(value: 'semantic', child: Text('Semantic')),
              DropdownMenuItem(value: 'visual', child: Text('Visual')),
              DropdownMenuItem(value: 'keyword', child: Text('Keyword')),
            ],
            onChanged: (value) => setState(() {
              mode = value ?? 'hybrid';
            }),
          ),
          if (loading) const LinearProgressIndicator(),
          if (error != null)
            Padding(padding: const EdgeInsets.all(12), child: Text(error!)),
          const SizedBox(height: 12),
          Expanded(
              child: hits.isEmpty && !loading
                  ? const Center(child: Text('No matching documents'))
                  : ListView.builder(
                      itemCount: hits.length,
                      itemBuilder: (context, index) {
                        final hit = hits[index];
                        final document = DocumentModel.fromMap(hit['document']);
                        return ListTile(
                          title: Text(document.name),
                          subtitle: Text(
                              'Page ${hit['page']} · ${hit['snippet'] ?? ''}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis),
                          onTap: () => context
                              .push(DocumentRoutes.documentDetail, extra: {
                            'document': document,
                            'showOptions': true
                          }),
                        );
                      },
                    )),
        ]),
      ),
    );
  }
}
