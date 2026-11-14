import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatDate } from "../api";
import {
  Button,
  RefreshButton,
  PageHeader,
  Loading,
  ErrorState,
  EmptyState,
  Table,
  Status,
} from "../ui";
import type { AuditEntry } from "../../shared/types";
import { displayAuditAction } from "../../shared/audit";

export default function Audit() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["audit", page],
    queryFn: ({ signal }) =>
      api<{ items: AuditEntry[]; total: number }>(`/audit?page=${page}`, {
        signal,
      }),
  });
  return (
    <>
      <PageHeader
        title="操作记录"
        actions={
          <RefreshButton
            aria-label="刷新操作记录"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          />
        }
      />
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : !query.data?.items.length ? (
          <EmptyState title="暂无操作记录" />
        ) : (
          <>
            <div className="table-scroll">
              <Table className="audit-table">
                <Table.Header>
                  <Table.Row>
                    <Table.Head>操作时间</Table.Head>
                    <Table.Head>操作</Table.Head>
                    <Table.Head>账号</Table.Head>
                    <Table.Head>资源</Table.Head>
                    <Table.Head>结果</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {query.data.items.map((item) => (
                    <Table.Row key={item.id}>
                      <Table.Cell className="nowrap">
                        {formatDate(item.createdAt)}
                      </Table.Cell>
                      <Table.Cell className="nowrap">
                        {displayAuditAction(
                          item.action,
                          item.status,
                          item.resource,
                        )}
                      </Table.Cell>
                      <Table.Cell className="nowrap">
                        {item.accountName || "—"}
                      </Table.Cell>
                      <Table.Cell>
                        <span className="break-all">{item.resource}</span>
                        {(item.detail || item.action === "批量修改 DNS") && (
                          <small className="cell-note">
                            {item.detail}
                            {item.action === "批量修改 DNS" &&
                              `${item.detail ? "；" : ""}旧记录未保存具体操作类型`}
                          </small>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Status value={item.status} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table>
            </div>
            <div className="table-footer">
              <span>共 {query.data.total} 条记录</span>
              <div className="actions">
                <Button
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  上一页
                </Button>
                <span>{page}</span>
                <Button
                  size="sm"
                  disabled={page * 50 >= query.data.total}
                  onClick={() => setPage((current) => current + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
