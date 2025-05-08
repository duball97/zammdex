import confetti from "canvas-confetti";
import { useState, useEffect, useRef, ChangeEvent, DragEvent } from "react";
import { CoinchanAbi, CoinchanAddress } from "./constants/Coinchan";
import { useAccount, useWriteContract } from "wagmi";
import { parseEther } from "viem";
import { pinImageToPinata, pinJsonToPinata } from "./utils/pinata";
import { handleWalletError, isUserRejectionError } from "./utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Define proper types for the ImageInput component
interface ImageInputProps {
  onChange: (file: File | File[] | undefined) => void;
}

// Fixed ImageInput component with drag and drop and preview
const ImageInput = ({ onChange }: ImageInputProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
      // Reset the input value to ensure onChange fires even if the same file is selected again
      e.target.value = '';
    }
  };

  const handleFile = (file: File) => {
    setSelectedFileName(file.name);
    
    // Create preview URL
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    
    // Call parent onChange handler
    onChange(file);
    
    // Clean up the preview URL when component unmounts
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  };
  
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };
  
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };
  
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files?.length) {
      handleFile(files[0]);
    }
  };

  // Clean up the URL when component unmounts
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);
  
  const commonBorderClass = "border-2 border-dashed rounded-[var(--radius-lg)]";
  const draggingClass = "border-[var(--primary-light)] dark:border-[var(--primary-dark)] bg-[var(--primary-light)]/10 dark:bg-[var(--primary-dark)]/10";
  const defaultBorderClass = "border-[var(--border-light)] dark:border-[var(--border-dark)] hover:border-[var(--muted-foreground-light)] dark:hover:border-[var(--muted-foreground-dark)]";

  return (
    <div className="flex flex-col gap-3 w-full text-[var(--foreground-light)] dark:text-[var(--foreground-dark)]">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
      <div 
        className={`flex flex-col items-center justify-center p-6 ${commonBorderClass} ${isDragging ? draggingClass : defaultBorderClass} transition-colors duration-200 cursor-pointer min-h-[150px]`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {previewUrl ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <img 
              src={previewUrl} 
              alt="Preview" 
              className="max-h-32 max-w-full object-contain rounded-[var(--radius-md)] shadow-md" 
            />
            <div className="flex flex-col items-center">
              <p className="text-xs text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)] mb-1 truncate max-w-[200px]">{selectedFileName}</p>
              <span className="text-sm text-[var(--primary-light)] dark:text-[var(--primary-dark)] hover:underline cursor-pointer font-medium">
                Change Image
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)] flex flex-col items-center gap-1">
            <p className="font-medium text-sm">Drag & drop image here</p>
            <p className="text-xs">or click to browse</p>
          </div>
        )}
      </div>
    </div>
  );
};

export function CoinForm({
}: {
}) {
  const [formState, setFormState] = useState({
    name: "",
    symbol: "",
    description: "",
    logo: "",
    creatorSupply: "0",
  });

  const [imageBuffer, setImageBuffer] = useState<ArrayBuffer | null>(null);
  const { address } = useAccount();

  const TOTAL_SUPPLY = 21000000;
  const swapFee = 100;
  const vestingDuration = 15778476;
  const vesting = true;

  const { writeContract, isPending, isSuccess, data, error } = useWriteContract();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!address || !imageBuffer) {
      // Error will be shown in UI
      setErrorMessage(!address ? "Wallet not connected" : "Please upload an image and wait for it to process");
      return;
    }

    const creatorSupplyValue = Number(formState.creatorSupply) || 0;
    const safeCreatorSupply = Math.min(creatorSupplyValue, TOTAL_SUPPLY);
    const finalPoolSupply = TOTAL_SUPPLY - safeCreatorSupply;

    try {
      const fileName = `${formState.name}_logo.png`;
      const pinataMetadata = { name: fileName };

      const imageHash = await pinImageToPinata(
        imageBuffer,
        fileName,
        pinataMetadata,
      );

      const tokenUriJson = {
        name: formState.name,
        symbol: formState.symbol,
        description: formState.description,
        image: imageHash,
      };

      const tokenUriHash = await pinJsonToPinata(tokenUriJson);

      try {
        writeContract({
          address: CoinchanAddress,
          abi: CoinchanAbi,
          functionName: "makeLocked",
          value: parseEther("0.01"),
          args: [
            formState.name,
            formState.symbol,
            tokenUriHash,
            parseEther(finalPoolSupply.toString()),
            parseEther(safeCreatorSupply.toString()),
            BigInt(swapFee),
            address,
            BigInt(Math.floor(Date.now() / 1000) + vestingDuration),
            vesting,
          ],
        });

        // Show confetti only if the transaction was successful
        if (!isUserRejectionError(error)) {
          confetti({
            particleCount: 200,
            spread: 70,
            origin: { y: 0.6 },
            colors: ["#FFC700", "#FF8A00", "#FF005C", "#00C2FF", "#00E5A1"],
          });
        }
      } catch (txError) {
        // Handle wallet rejection silently
        if (!isUserRejectionError(txError)) {
          const errorMsg = handleWalletError(txError);
          if (errorMsg) {
            setErrorMessage(errorMsg);
          }
        }
      }
    } catch (pinataError) {
      // Error will be shown in UI
      setErrorMessage("Failed to upload image to IPFS. Please try again.");
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChangeInternal = (file: File | File[] | undefined) => {
    const singleFile = Array.isArray(file) ? file[0] : file;
    setImageBuffer(null);
    if (singleFile) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageBuffer(reader.result as ArrayBuffer);
      };
      reader.onerror = () => {
        setErrorMessage("Failed to read image file.");
        setImageBuffer(null);
      };
      reader.readAsArrayBuffer(singleFile);
    }
  };

  const inputBaseClass = "w-full bg-[var(--input-background-light)] dark:bg-[var(--input-background-dark)] text-[var(--input-foreground-light)] dark:text-[var(--input-foreground-dark)] border border-[var(--input-border-light)] dark:border-[var(--input-border-dark)] rounded-[var(--radius-md)] px-3 py-2 text-sm placeholder:text-[var(--muted-foreground-light)] dark:placeholder:text-[var(--muted-foreground-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--ring-light)] dark:focus:ring-[var(--ring-dark)] focus:border-transparent transition-shadow duration-150 shadow-sm hover:shadow-md";

  return (
    <div className="w-full bg-[var(--card-background-light)] dark:bg-[var(--card-background-dark)] p-5 sm:p-6 rounded-[var(--radius-lg)] shadow-lg text-[var(--foreground-light)] dark:text-[var(--foreground-dark)]">
      <form onSubmit={handleSubmit} className="space-y-6 w-full">
        <div className="space-y-1.5 w-full">
          <Label htmlFor="name" className="text-xs font-medium text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)]">NAME</Label>
          <Input
            id="name"
            name="name"
            value={formState.name}
            onChange={handleChange}
            required
            className={inputBaseClass}
            placeholder="My Awesome Coin"
          />
        </div>

        <div className="space-y-1.5 w-full">
          <Label htmlFor="symbol" className="text-xs font-medium text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)]">SYMBOL</Label>
          <Input
            id="symbol"
            name="symbol"
            value={formState.symbol}
            onChange={handleChange}
            required
            className={inputBaseClass}
            placeholder="MAC"
          />
        </div>

        <div className="space-y-1.5 w-full">
          <Label htmlFor="description" className="text-xs font-medium text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)]">DESCRIPTION</Label>
          <Textarea
            id="description"
            name="description"
            value={formState.description}
            onChange={handleChange}
            required
            className={`${inputBaseClass} min-h-[100px]`}
            placeholder="A brief description of your coin."
          />
        </div>
        
        <div className="space-y-1.5 w-full">
          <Label className="text-xs font-medium text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)]">LOGO</Label>
          <ImageInput onChange={handleFileChangeInternal} />
        </div>

        <div className="space-y-1.5 w-full">
          <Label htmlFor="creatorSupply" className="text-xs font-medium text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)]">
            YOUR TOKENS (Max: {TOTAL_SUPPLY.toLocaleString()})
          </Label>
          <Input
            id="creatorSupply"
            name="creatorSupply"
            type="number"
            value={formState.creatorSupply}
            onChange={handleChange}
            min="0"
            max={TOTAL_SUPPLY}
            className={inputBaseClass}
          />
           <p className="text-xs text-[var(--muted-foreground-light)] dark:text-[var(--muted-foreground-dark)] pt-1">
            Pool will receive: {(TOTAL_SUPPLY - (Number(formState.creatorSupply) || 0)).toLocaleString()} tokens.
          </p>
        </div>

        {errorMessage && (
          <p className="text-sm text-[var(--destructive-foreground-light)] dark:text-[var(--destructive-foreground-dark)] bg-[var(--destructive-light)] dark:bg-[var(--destructive-dark)] p-3 rounded-[var(--radius-md)]">{errorMessage}</p>
        )}
        {isPending && (
          <p className="text-sm text-blue-400">Processing transaction...</p>
        )}
        {isSuccess && data && (
           <p className="text-sm text-green-600 dark:text-green-400 bg-green-500/10 dark:bg-green-500/20 p-3 rounded-[var(--radius-md)]">Coin launched successfully! Transaction: {typeof data === 'string' ? data.substring(0,10) : 'submitted'}...</p>
        )}

        <Button type="submit" disabled={isPending || !address || !imageBuffer} 
          className={`w-full bg-[var(--primary-light)] dark:bg-[var(--primary-dark)] text-[var(--primary-foreground-light)] dark:text-[var(--primary-foreground-dark)] font-semibold py-2.5 px-4 rounded-[var(--radius-md)] transition-all duration-150 ease-in-out 
                     hover:opacity-90 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--ring-light)] dark:focus-visible:ring-[var(--ring-dark)]
                     disabled:opacity-60 disabled:cursor-not-allowed shadow-md hover:shadow-lg`}
        >
          {isPending ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Launching...
            </span>
          ) : "Launch Coin (0.01 ETH)"}
        </Button>
      </form>
    </div>
  );
}
