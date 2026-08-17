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
})
