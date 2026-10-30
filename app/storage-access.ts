const accessLock = 'lumior-attachment-access-v1';

// Open workspaces retain a shared lease, protecting the undo history of each
// window. Cleanup can only acquire exclusive access when other windows close.
export class StorageAccess {
  private lease: {
    ready: Promise<void>;
    finished: Promise<unknown>;
    release: () => void;
  } | null = null;
  private locks?: Pick<LockManager, 'request'>;
  constructor(locks?: Pick<LockManager, 'request'>) {
    this.locks = locks;
  }
  async hold() {
    if (!this.locks) return;
    if (this.lease) return this.lease.ready;
    let release!: () => void,
      ready!: () => void,
      fail!: (error: unknown) => void;
    const stopped = new Promise<void>((resolve) => {
      release = resolve;
    });
    const granted = new Promise<void>((resolve, reject) => {
      ready = resolve;
      fail = reject;
    });
    const finished = this.locks.request(
      accessLock,
      { mode: 'shared' },
      async () => {
        ready();
        await stopped;
      },
    );
    void finished.catch(fail);
    this.lease = { ready: granted, finished, release };
    return granted;
  }
  async release() {
    const lease = this.lease;
    this.lease = null;
    if (lease) {
      lease.release();
      await lease.finished;
    }
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (!this.locks)
      throw new Error(
        '当前浏览器不支持安全清理。可以查看文件、下载和导出备份。',
      );
    await this.release();
    try {
      return await this.locks.request(
        accessLock,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              '请先关闭其他 Lumior 页面，再清理附件，以保留其他窗口的撤销记录。',
            );
          return action();
        },
      );
    } finally {
      await this.hold();
    }
  }
}
