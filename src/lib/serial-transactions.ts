import type { PrismaPg } from "@prisma/adapter-pg"

// The driver adapter's own types, read from the factory PrismaClient takes
type SqlDriverAdapter = Awaited<ReturnType<PrismaPg["connect"]>>
type Transaction = Awaited<ReturnType<SqlDriverAdapter["startTransaction"]>>

// Every query inside an interactive transaction ($transaction(async (tx) =>
// ...)) runs on one pg connection, and pg only runs one query at a time on
// a connection. Two queries sent to it at once log "Calling client.query()
// when the client is already executing a query is deprecated" (a future pg
// will refuse them). That happens even without a Promise.all in our code:
// Prisma reads a select with several relations as one query per relation
// and sends those at the same time.
//
// This wraps the driver adapter so each transaction queues its queries and
// sends the next only when the one before has answered. pg already ran them
// one at a time, so nothing changes but the warning. Queries outside a
// transaction go through the pool, which runs them on separate connections,
// and are left alone.

// Runs each task after the one before it has settled, whatever its outcome
function serialQueue() {
  let last: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = last.then(task, task)
    last = next.catch(() => undefined)
    return next
  }
}

const QUEUED_METHODS = ["queryRaw", "executeRaw", "commit", "rollback", "createSavepoint", "rollbackToSavepoint", "releaseSavepoint"] as const

export function serialTransaction(tx: Transaction): Transaction {
  const run = serialQueue()
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== "function") return value
      if ((QUEUED_METHODS as readonly PropertyKey[]).includes(prop)) {
        return (...args: unknown[]) => run(() => value.apply(target, args))
      }
      return value.bind(target)
    },
  })
}

function serialAdapter(adapter: SqlDriverAdapter): SqlDriverAdapter {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === "startTransaction") {
        return async (...args: Parameters<SqlDriverAdapter["startTransaction"]>) => serialTransaction(await target.startTransaction(...args))
      }
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

// The adapter factory PrismaClient takes, with every transaction it starts
// running its queries one after another
export function withSerialTransactions(factory: PrismaPg): PrismaPg {
  return new Proxy(factory, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === "connect") return async () => serialAdapter(await target.connect())
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
