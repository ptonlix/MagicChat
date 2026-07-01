import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  MoreHorizontalIcon,
} from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from "@/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

type Member = {
  email: string
  id: string
  joinedAt: string
  name: string
  status: "disabled" | "enabled"
}

const pageSizeOptions = [50, 100, 200, 500] as const
type PageSize = (typeof pageSizeOptions)[number]
type PaginationItemModel =
  | {
      page: number
      type: "page"
    }
  | {
      key: string
      type: "ellipsis"
    }

const columnLabels: Record<string, string> = {
  email: "邮箱",
  joinedAt: "加入时间",
  name: "名称",
  status: "状态",
}

const columns: ColumnDef<Member>[] = [
  {
    id: "select",
    enableHiding: false,
    enableSorting: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="选择当前页全部成员"
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={
          table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
        }
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={`选择 ${row.original.name}`}
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked)}
      />
    ),
  },
  {
    accessorKey: "email",
    header: ({ column }) => (
      <Button
        className="-ml-2"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        size="sm"
        variant="ghost"
      >
        邮箱
        <ArrowUpDownIcon data-icon="inline-end" />
      </Button>
    ),
    cell: ({ row }) => row.getValue("email"),
  },
  {
    accessorKey: "name",
    header: "名称",
    cell: ({ row }) => row.getValue("name"),
  },
  {
    accessorKey: "joinedAt",
    header: ({ column }) => (
      <Button
        className="-ml-2"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        size="sm"
        variant="ghost"
      >
        加入时间
        <ArrowUpDownIcon data-icon="inline-end" />
      </Button>
    ),
    cell: ({ row }) => row.getValue("joinedAt"),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <Button
        className="-ml-2"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        size="sm"
        variant="ghost"
      >
        状态
        <ArrowUpDownIcon data-icon="inline-end" />
      </Button>
    ),
    cell: ({ row }) => {
      const status = row.original.status

      return (
        <Badge
          className={cn(
            status === "enabled" &&
              "border-transparent bg-sky-500/14 text-sky-700 dark:bg-sky-400/14 dark:text-sky-300"
          )}
          variant="secondary"
        >
          {status === "enabled" ? "启用" : "禁用"}
        </Badge>
      )
    },
  },
  {
    id: "actions",
    enableHiding: false,
    enableSorting: false,
    header: () => <div className="text-right">操作</div>,
    cell: ({ row }) => (
      <div className="text-right">
        <MemberActions member={row.original} />
      </div>
    ),
  },
]

const mockNames = [
  "陈若宁",
  "林子墨",
  "周安琪",
  "李明轩",
  "赵思远",
  "王雨桐",
  "刘景行",
  "孙嘉怡",
  "吴承泽",
  "郑书瑶",
  "何彦霖",
  "唐诗涵",
  "宋一鸣",
  "许知夏",
  "高睿诚",
  "程予安",
]

const mockMembers: Member[] = Array.from({ length: 1388 }, (_, index) => {
  const memberNumber = index + 1
  const month = String((index % 12) + 1).padStart(2, "0")
  const day = String((index % 27) + 1).padStart(2, "0")

  return {
    email: `member${String(memberNumber).padStart(3, "0")}@mygod.example`,
    id: `member-${memberNumber}`,
    joinedAt: `2025-${month}-${day}`,
    name: mockNames[index % mockNames.length],
    status: index % 5 === 0 ? "disabled" : "enabled",
  }
})

export default function MembersPage() {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  })
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [sorting, setSorting] = useState<SortingState>([])

  // TanStack Table returns table methods that React Compiler should not memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns,
    data: mockMembers,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    state: {
      columnFilters,
      columnVisibility,
      pagination,
      rowSelection,
      sorting,
    },
  })
  const page = pagination.pageIndex + 1
  const pageCount = table.getPageCount()
  const visiblePaginationItems = getVisiblePaginationItems(page, pageCount)

  function setPageSize(value: string | null) {
    if (!isPageSize(value)) {
      return
    }

    setPagination({
      pageIndex: 0,
      pageSize: Number(value),
    })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          className="sm:max-w-sm"
          onChange={(event) => {
            table.getColumn("email")?.setFilterValue(event.target.value)
            table.setPageIndex(0)
          }}
          placeholder="搜索用户"
          value={(table.getColumn("email")?.getFilterValue() as string) ?? ""}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className="w-fit self-end sm:self-auto"
                variant="outline"
              />
            }
          >
            选择列
            <ChevronDownIcon data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuGroup>
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    checked={column.getIsVisible()}
                    key={column.id}
                    onCheckedChange={(checked) =>
                      column.toggleVisibility(checked)
                    }
                  >
                    {getColumnLabel(column.id)}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-lg border bg-background">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    className={
                      header.column.id === "select"
                        ? "w-10"
                        : header.column.id === "actions"
                          ? "w-24 pr-6"
                          : undefined
                    }
                    key={header.id}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  className={cn(
                    row.original.status === "disabled" &&
                      "text-muted-foreground"
                  )}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  key={row.id}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      className={
                        cell.column.id === "actions" ? "w-24 pr-6" : undefined
                      }
                      key={cell.id}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  className="h-24 text-center"
                  colSpan={table.getAllColumns().length}
                >
                  没有结果
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select onValueChange={setPageSize} value={String(pagination.pageSize)}>
          <SelectTrigger className="w-32" size="sm">
            <SelectValue>{`每页 ${pagination.pageSize} 条`}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {`每页 ${option} 条`}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            {visiblePaginationItems.map((item) =>
              item.type === "ellipsis" ? (
                <PaginationItem key={item.key}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item.page}>
                  <PaginationLink
                    href="#"
                    isActive={item.page === page}
                    onClick={(event) => {
                      event.preventDefault()
                      table.setPageIndex(item.page - 1)
                    }}
                  >
                    {item.page}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}

function MemberActions({ member }: { member: Member }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={`打开 ${member.name} 的操作菜单`}
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        <span className="sr-only">Open menu</span>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem>启用</DropdownMenuItem>
          <DropdownMenuItem>禁用</DropdownMenuItem>
          <DropdownMenuItem>重置密码</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function getColumnLabel(columnId: string) {
  return columnLabels[columnId] ?? columnId
}

function getVisiblePaginationItems(
  page: number,
  totalPages: number
): PaginationItemModel[] {
  const pageNumbers = new Set<number>()

  for (
    let pageNumber = 1;
    pageNumber <= Math.min(3, totalPages);
    pageNumber++
  ) {
    pageNumbers.add(pageNumber)
  }

  for (
    let pageNumber = Math.max(1, page - 2);
    pageNumber <= Math.min(totalPages, page + 2);
    pageNumber++
  ) {
    pageNumbers.add(pageNumber)
  }

  for (
    let pageNumber = Math.max(1, totalPages - 2);
    pageNumber <= totalPages;
    pageNumber++
  ) {
    pageNumbers.add(pageNumber)
  }

  return Array.from(pageNumbers)
    .sort((firstPage, secondPage) => firstPage - secondPage)
    .reduce<PaginationItemModel[]>((items, pageNumber, index, pages) => {
      const previousPage = pages[index - 1]

      if (previousPage && pageNumber - previousPage > 1) {
        items.push({
          key: `ellipsis-${previousPage}-${pageNumber}`,
          type: "ellipsis",
        })
      }

      items.push({
        page: pageNumber,
        type: "page",
      })

      return items
    }, [])
}

function isPageSize(value: string | null): value is `${PageSize}` {
  return pageSizeOptions.some((option) => String(option) === value)
}
