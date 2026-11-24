import { render } from "solid-js/web";
import { HashRouter, Route, type RouteSectionProps } from "@solidjs/router";
import { Footer, Header } from "./components";
import { AdminPage, ContestPage, EditPage, EntryPage, Home, SubmitPage } from "./pages";
import { AdminVotesPage } from "./votes";
import "./style.css";

function Layout(p: RouteSectionProps) {
  return (
    <>
      <Header />
      <main class="container">{p.children}</main>
      <Footer />
    </>
  );
}

render(
  () => (
    <HashRouter root={Layout}>
      <Route path="/" component={Home} />
      <Route path="/contests/:id" component={ContestPage} />
      <Route path="/contests/:id/submit" component={SubmitPage} />
      <Route path="/entries/:id" component={EntryPage} />
      <Route path="/entries/:id/edit" component={EditPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/admin/contests/:id/votes" component={AdminVotesPage} />
      <Route path="*" component={() => <div class="card">ページが見つかりません。</div>} />
    </HashRouter>
  ),
  document.getElementById("root")!,
);
