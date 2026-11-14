import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowRightIcon, PlusIcon } from "@phosphor-icons/react";
import { api } from "../api";
import { useAccount } from "../context";
import {
  Button,
  RefreshButton,
  Text,
  PageHeader,
  EmptyState,
  ErrorState,
  Loading,
  Table,
} from "../ui";
import type { Bucket, Zone } from "../../shared/types";

export function Overview() {
  const { account } = useAccount();
  const navigate = useNavigate();
  const zones = useQuery({
    queryKey: ["zones", account?.id],
    queryFn: ({ signal }) =>
      api<Zone[]>(`/accounts/${account!.id}/dns/zones`, { signal }),
    enabled: Boolean(account),
  });
  const buckets = useQuery({
    queryKey: ["buckets", account?.id, "default"],
    queryFn: ({ signal }) =>
      api<Bucket[]>(`/accounts/${account!.id}/r2/buckets`, { signal }),
    enabled: Boolean(account),
  });
  return (
    <>
      <PageHeader
        title="概览"
        actions={
          <RefreshButton
            aria-label="刷新资源"
            disabled={!account}
            loading={zones.isFetching || buckets.isFetching}
            onClick={() => {
              void zones.refetch();
              void buckets.refetch();
            }}
          />
        }
      />
      {!account ? (
        <div className="panel">
          <EmptyState
            title="连接 Cloudflare 账号"
            action={
              <Button
                variant="primary"
                onClick={() => navigate("/settings?tab=accounts")}
              >
                <PlusIcon size={18} />
                添加账号
              </Button>
            }
          />
        </div>
      ) : (
        <div className="overview-resources">
          <section className="panel">
            <div className="section-heading">
              <Text variant="heading" as="h2">
                域名
              </Text>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/dns")}
              >
                查看全部
                <ArrowRightIcon size={16} />
              </Button>
            </div>
            {zones.isPending ? (
              <Loading />
            ) : zones.error ? (
              <ErrorState
                error={zones.error}
                retry={() => void zones.refetch()}
              />
            ) : !zones.data?.length ? (
              <EmptyState title="暂无域名" />
            ) : (
              <div className="table-scroll">
                <Table layout="fixed">
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>域名</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {zones.data.slice(0, 5).map((zone) => (
                      <Table.Row key={zone.id}>
                        <Table.Cell>
                          <button
                            className="resource-link"
                            onClick={() => navigate(`/dns?zone=${zone.id}`)}
                          >
                            {zone.name}
                          </button>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </section>
          <section className="panel">
            <div className="section-heading">
              <Text variant="heading" as="h2">
                R2 存储桶
              </Text>
              <Button variant="ghost" size="sm" onClick={() => navigate("/r2")}>
                查看全部
                <ArrowRightIcon size={16} />
              </Button>
            </div>
            {buckets.isPending ? (
              <Loading />
            ) : buckets.error ? (
              <ErrorState
                error={buckets.error}
                retry={() => void buckets.refetch()}
              />
            ) : !buckets.data?.length ? (
              <EmptyState title="暂无存储桶" />
            ) : (
              <div className="table-scroll">
                <Table layout="fixed">
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>存储桶</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {buckets.data.slice(0, 5).map((bucket) => (
                      <Table.Row key={bucket.name}>
                        <Table.Cell>
                          <button
                            className="resource-link"
                            onClick={() =>
                              navigate(
                                `/r2?bucket=${encodeURIComponent(bucket.name)}`,
                              )
                            }
                          >
                            {bucket.name}
                          </button>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
