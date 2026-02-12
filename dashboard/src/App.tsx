import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Search } from "./pages/Search";
import { Sessions } from "./pages/Sessions";
import { Settings } from "./pages/Settings";
import { Stats } from "./pages/Stats";
import { Timeline } from "./pages/Timeline";
import { Ops } from "./pages/Ops";

export function App() {
	return (
		<HashRouter>
			<Routes>
				<Route element={<Layout />}>
					<Route index element={<Timeline />} />
					<Route path="sessions" element={<Sessions />} />
					<Route path="search" element={<Search />} />
					<Route path="stats" element={<Stats />} />
					<Route path="ops" element={<Ops />} />
					<Route path="settings" element={<Settings />} />
				</Route>
			</Routes>
		</HashRouter>
	);
}
