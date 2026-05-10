import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProvider } from "@/contexts/WalletContext";
import { LocationProvider } from "@/contexts/LocationContext";
import Navbar from "@/components/Navbar";
import NetworkBanner from "@/components/NetworkBanner";
import Index from "./pages/Index";
import RidePage from "./pages/RidePage";
import DriverPage from "./pages/DriverPage";
import ActivityPage from "./pages/ActivityPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <WalletProvider>
          <LocationProvider>
            <Navbar />
            <NetworkBanner />
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/ride" element={<RidePage />} />
              <Route path="/driver" element={<DriverPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </LocationProvider>
        </WalletProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
