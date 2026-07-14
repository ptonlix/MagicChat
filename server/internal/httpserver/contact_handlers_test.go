package httpserver

import (
	"testing"

	"app/internal/store"
)

func TestContactGroupAvatarMembersAreRoleOrderedAndLimited(t *testing.T) {
	members := []conversationMemberResponse{
		{Name: "Member One", Role: store.ConversationMemberRoleMember},
		{Name: "Member Two", Role: store.ConversationMemberRoleMember},
		{Name: "Owner", Role: store.ConversationMemberRoleOwner},
		{Name: "Admin", Role: store.ConversationMemberRoleAdmin},
		{Name: "Member Three", Role: store.ConversationMemberRoleMember},
	}

	got := newContactGroupAvatarMemberResponses(members)
	if len(got) != 4 {
		t.Fatalf("avatar members = %d, want 4", len(got))
	}
	wantNames := []string{"Owner", "Admin", "Member One", "Member Two"}
	for index, wantName := range wantNames {
		if got[index].Name != wantName {
			t.Fatalf("avatar member %d = %q, want %q", index, got[index].Name, wantName)
		}
	}
}
