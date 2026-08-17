import { describe, expect, it } from "vitest"

import type { ClientTopicSourceMessage, ContactUser } from "@/lib/client-data-api"
import { getTopicSourceSenderProfile } from "./topic-source-message"

describe("getTopicSourceSenderProfile", () => {
  it("prefers the local directory profile for a non-friend group member", () => {
    const member: ContactUser = {
      avatar: "/avatars/member.webp",
      email: "member@example.test",
      id: "member-id",
      lastOnlineAt: null,
      name: "群成员姓名",
      nickname: "群成员昵称",
      online: false,
      phone: "",
      type: "user",
    }

    expect(
      getTopicSourceSenderProfile(
        { avatar: "", id: member.id, name: member.id, type: "user" },
        { avatar: "", id: "current-user", name: "当前用户", nickname: "" },
        { [member.id]: member },
        new Map(),
      ),
    ).toEqual({
      avatar: "/avatars/member.webp",
      name: "群成员昵称",
    })
  })

  it("uses the application directory before the source payload", () => {
    const sender: ClientTopicSourceMessage["sender"] = {
      avatar: "/avatars/source.webp",
      id: "app-id",
      name: "来源应用",
      type: "app",
    }

    expect(
      getTopicSourceSenderProfile(
        sender,
        undefined,
        {},
        new Map([
          [
            sender.id,
            {
              avatar: "/avatars/app.webp",
              creatorUserId: null,
              description: "",
              id: sender.id,
              name: "目录应用",
              online: true,
              type: "app",
            },
          ],
        ]),
      ),
    ).toEqual({ avatar: "/avatars/app.webp", name: "目录应用" })
  })

  it("当前用户发送时优先使用当前资料", () => {
    const sender: ClientTopicSourceMessage["sender"] = {
      avatar: "/avatars/source.webp",
      id: "current-user",
      name: "来源名称",
      type: "user",
    }

    expect(
      getTopicSourceSenderProfile(
        sender,
        {
          avatar: "/avatars/current.webp",
          id: sender.id,
          name: "当前姓名",
          nickname: "当前昵称",
        },
        {},
        new Map(),
      ),
    ).toEqual({ avatar: "/avatars/current.webp", name: "当前昵称" })
  })

  it("目录缺失时保留服务端发送者资料", () => {
    const userSender: ClientTopicSourceMessage["sender"] = {
      avatar: "/avatars/user-source.webp",
      id: "missing-user",
      name: "来源用户",
      type: "user",
    }
    const appSender: ClientTopicSourceMessage["sender"] = {
      avatar: "/avatars/app-source.webp",
      id: "missing-app",
      name: "来源应用",
      type: "app",
    }

    expect(getTopicSourceSenderProfile(userSender, undefined, {}, new Map())).toEqual({
      avatar: "/avatars/user-source.webp",
      name: "来源用户",
    })
    expect(getTopicSourceSenderProfile(appSender, undefined, {}, new Map())).toEqual({
      avatar: "/avatars/app-source.webp",
      name: "来源应用",
    })
  })
})
