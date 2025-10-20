import { observer } from "mobx-react-lite";
import SearchBar from "@/components/SearchBar";
import { cn } from "@/lib/utils";
import MemoFilters from "../MemoFilters";
import StatisticsView from "../StatisticsView";
import TagsSection from "./TagsSection";

interface Props {
  className?: string;
}

const HomeSidebar = observer((props: Props) => {
  return (
    <aside
      className={cn(
        "relative w-full h-full overflow-auto flex flex-col justify-start items-start bg-background text-sidebar-foreground",
        props.className,
      )}
    >
      <SearchBar />
      <MemoFilters />
      <div className="mt-1 px-1 w-full">
        <StatisticsView />
        <TagsSection />
      </div>
    </aside>
  );
});

export default HomeSidebar;
