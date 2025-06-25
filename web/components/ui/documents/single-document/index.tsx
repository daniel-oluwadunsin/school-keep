'use client';
import documentService from '@/lib/services/documents.service';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import React from 'react';
import SingleDocumentPageSkeleton from './skeleton';
import SingleDocumentHeader from './header';
import OtherDocumentVersion from './other-versions';
import { DocumentAnalysis } from '@/lib/schemas/types';

const SingleDocumentPage = () => {
  const router = useRouter();
  const { id: documentId } = useParams();

  const { data, isLoading: fetchingDocument } = useQuery({
    queryKey: ['useGetDocument', documentId],
    queryFn: async () => documentService.getDocument(documentId as string),
  });
  const { data: analysis } = useQuery<DocumentAnalysis | null>({
    queryKey: ['document-analysis', documentId],
    queryFn: () => documentService.getAnalysis(documentId as string),
    enabled: Boolean(documentId),
    refetchInterval: (query) => ['queued', 'processing'].includes(query.state.data?.status || '') ? 5000 : false,
  });

  if (!data || fetchingDocument) {
    return <SingleDocumentPageSkeleton />;
  }

  const doc = data?.data;

  return (
    <section className="my-5">
      <SingleDocumentHeader document={doc} />
      <OtherDocumentVersion otherVersions={data?.meta?.otherVersions ?? []} />
      <section className="mt-8 rounded border bg-white p-5">
        <h2 className="text-lg font-semibold">Document analysis</h2>
        {!analysis ? <p>Analysis has not been run for this version.</p> : <>
          <p>Status: {analysis.status} · Student match: {analysis.matchStatus}</p>
          {analysis.documentType && <p>Type: {analysis.documentType}</p>}
          {analysis.error && <p role="alert" className="text-red-700">{analysis.error}</p>}
          <div className="mt-3 max-h-80 space-y-3 overflow-auto">
            {analysis.pages?.map((page) => <details key={page.page} className="rounded border p-3">
              <summary>Page {page.page} · OCR text</summary>
              {page.layout?.fields?.length ? <ul className="mt-2 list-disc pl-5 text-sm">
                {page.layout.fields.map((field, index) => <li key={index}>
                  {field.key}: {field.value} ({Math.round(field.confidence * 100)}%)
                </li>)}
              </ul> : null}
              <pre className="mt-2 whitespace-pre-wrap text-sm">{page.text}</pre>
            </details>)}
          </div>
        </>}
      </section>
    </section>
  );
};

export default SingleDocumentPage;
