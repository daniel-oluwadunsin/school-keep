'use client';
import React, { FC, useState } from 'react';
import DocumentsPageHeader from './header';
import { View } from '@/lib/schemas/enums';
import { ResearchMode } from '@/lib/schemas/types';
import { useApiQuery } from '@/lib/hooks/use-query';
import { GetAllDocumentsQuery } from '@/lib/schemas/interfaces';
import { useQuery } from '@tanstack/react-query';
import documentService from '@/lib/services/documents.service';
import DocumentsGridView from './grid-view';
import { DocumentsTable } from '../tables/documents';
import {
  fullColumns,
  studentFolderDocumentsColumns,
} from '../tables/documents/columns';

interface Props {
  folderId?: string;
  studentId?: string;
  onClose?(): void;
}

const DocumentsList: FC<Props> = ({ folderId, onClose, studentId }) => {
  const { changeQuery, query } = useApiQuery<GetAllDocumentsQuery>({
    defaultValues: {
      search: '',
    },
  });
  const [view, setView] = useState<View>(View.grid);
  const [mode, setMode] = useState<ResearchMode>('hybrid');

  const onChangeView = (view: View) => setView(view);

  const {
    data: documents,
    isLoading: gettingDocuments,
    isRefetching: refetchingDocuments,
  } = useQuery({
    queryKey: ['useGetAllDocuments', query.search, folderId],
    queryFn: async () =>
      documentService.getAllDocuments({
        search: query.search,
        folder_id: folderId as string,
      }),
  });

  const { data: hits = [], isLoading: searching, error: searchError } = useQuery({
    queryKey: ['document-research-search', query.search, mode],
    queryFn: () => documentService.search(query.search!, mode),
    enabled: Boolean(query.search?.trim()),
  });

  return (
    <section className="my-5">
      <DocumentsPageHeader
        studentId={studentId!}
        onSelect={onChangeView}
        selectedView={view}
        onSearch={(s) => changeQuery('search', s)}
        onClose={onClose}
        folderId={folderId!}
      />

      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="research-mode">Search mode</label>
        <select id="research-mode" className="rounded border p-2" value={mode}
          onChange={(event) => setMode(event.target.value as ResearchMode)}>
          <option value="hybrid">Hybrid</option>
          <option value="semantic">Semantic</option>
          <option value="visual">Visual</option>
          <option value="keyword">Keyword</option>
        </select>
      </div>

      {query.search?.trim() ? (
        <div className="space-y-3" aria-live="polite">
          {searching && <p>Searching documents…</p>}
          {searchError && <p role="alert">Search is unavailable. Try another mode or retry.</p>}
          {!searching && !searchError && hits.length === 0 && <p>No matching documents found.</p>}
          {hits.map((hit) => (
            <a key={`${hit.documentId}-${hit.page}`} href={`/dashboard/documents/${hit.documentId}`}
              className="block rounded border bg-white p-4 hover:border-purple-500">
              <strong>{hit.document.documentName}</strong>
              <span className="ml-3 text-sm">Page {hit.page}</span>
              {hit.snippet && <p className="mt-2 line-clamp-2 text-sm">{hit.snippet}</p>}
            </a>
          ))}
        </div>
      ) : view == View.grid ? (
        <DocumentsGridView
          documents={documents ?? []}
          loading={gettingDocuments || refetchingDocuments}
        />
      ) : (
        <DocumentsTable
          columns={folderId ? studentFolderDocumentsColumns : fullColumns}
          data={documents ?? []}
          loading={gettingDocuments || refetchingDocuments}
        />
      )}
    </section>
  );
};

export default DocumentsList;
