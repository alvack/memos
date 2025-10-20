import { observer } from "mobx-react-lite";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { memoServiceClient } from "@/grpcweb";
import useCurrentUser from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import { memoStore } from "@/store";
import { State } from "@/types/proto/api/v1/common";
import { Memo } from "@/types/proto/api/v1/memo_service";
import { User } from "@/types/proto/api/v1/user_service";
import { useTranslate } from "@/utils/i18n";

interface Props {
  memo: Memo;
  reactionType: string;
  users: User[];
}

const stringifyUsers = (users: User[], reactionType: string, t: (key: string, values?: Record<string, any>) => string): string => {
  if (users.length === 0) {
    return "";
  }
  if (users.length < 5) {
    return users.map((user) => user.displayName || user.username).join(", ") + " " + t("common.and") + " " + t("setting.memo-related.reacted-with", { reaction: reactionType.toLowerCase() });
  }
  return (
    `${users
      .slice(0, 4)
      .map((user) => user.displayName || user.username)
      .join(", ")} ${t("common.and")} ${users.length - 4} ${t("common.more")} ${t("setting.memo-related.reacted-with", { reaction: reactionType.toLowerCase() })}`
  );
};

const ReactionView = observer((props: Props) => {
  const { memo, reactionType, users } = props;
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const hasReaction = users.some((user) => currentUser && user.username === currentUser.username);
  const readonly = memo.state === State.ARCHIVED;

  const handleReactionClick = async () => {
    if (!currentUser || readonly) {
      return;
    }

    const index = users.findIndex((user) => user.username === currentUser.username);
    try {
      if (index === -1) {
        await memoServiceClient.upsertMemoReaction({
          name: memo.name,
          reaction: {
            contentId: memo.name,
            reactionType,
          },
        });
      } else {
        const reactions = memo.reactions.filter(
          (reaction) => reaction.reactionType === reactionType && reaction.creator === currentUser.name,
        );
        for (const reaction of reactions) {
          await memoServiceClient.deleteMemoReaction({ name: reaction.name });
        }
      }
    } catch {
      // Skip error.
    }
    await memoStore.getOrFetchMemoByName(memo.name, { skipCache: true });
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "h-7 border px-2 py-0.5 rounded-full flex flex-row justify-center items-center gap-1",
              "text-sm text-muted-foreground",
              currentUser && !readonly && "cursor-pointer",
              hasReaction && "bg-popover border-border",
            )}
            onClick={handleReactionClick}
          >
            <span>{reactionType}</span>
            <span className="opacity-60">{users.length}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{stringifyUsers(users, reactionType, t)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

export default ReactionView;
