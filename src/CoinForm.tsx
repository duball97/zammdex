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
  
  return (
    <div className="flex flex-col gap-2 w-full">
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
      <div 
        className={`flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-md ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
        } transition-colors duration-200`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {previewUrl ? (
          <div className="flex flex-col items-center gap-4">
            <img 
              src={previewUrl} 
              alt="Preview" 
              className="max-h-32 max-w-full object-contain rounded-md" 
            />
            <div className="flex flex-col items-center">
              <p className="text-sm text-gray-500 mb-2">{selectedFileName}</p>
              <Button 
                type="button"
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                size="sm"
              >
                Change Image
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="mb-2">Drag & drop image here</p>
            <p>or</p>
            <Button 
              type="button"
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              className="mt-2"
            >
              Browse Files
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export function CoinForm({
  onMemepaperClick,
}: {
  onMemepaperClick: () => void;
}) {
  const [formState, setFormState] = useState({
    name: "",
    symbol: "",
    description: "",
    logo: "",
    creatorSupply: "0",
  });

  const [imageFile, setImageFile] = useState<File | undefined>(undefined);
  const { address } = useAccount();

  const TOTAL_SUPPLY = 21000000;
  const [poolSupply, setPoolSupply] = useState(TOTAL_SUPPLY);
  const swapFee = 100;
  const vestingDuration = 15778476;
  const vesting = true;

  useEffect(() => {
    const creatorAmount = Number(formState.creatorSupply) || 0;
    const safeCreatorAmount = Math.min(creatorAmount, TOTAL_SUPPLY);
    setPoolSupply(TOTAL_SUPPLY - safeCreatorAmount);
  }, [formState.creatorSupply]);

  const { writeContract, isPending, isSuccess, data, error } = useWriteContract();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!address || !imageFile) {
      // Error will be shown in UI
      setErrorMessage(!address ? "Wallet not connected" : "Please upload an image");
      return;
    }

    const creatorSupplyValue = Number(formState.creatorSupply) || 0;
    const safeCreatorSupply = Math.min(creatorSupplyValue, TOTAL_SUPPLY);
    const finalPoolSupply = TOTAL_SUPPLY - safeCreatorSupply;

    try {
      const fileName = `${formState.name}_logo.png`;
      const pinataMetadata = { name: fileName };

      const imageHash = await pinImageToPinata(
        imageFile,
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
            particleCount: 666,
            spread: 666,
            scalar: 0.9,
            shapes: ["circle"],
            gravity: 0.9,
            colors: ["#f9bd20", "#c17a00", "#fff9e6"],
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
    if (singleFile) {
      setImageFile(singleFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        // Assuming setImageBuffer is defined and takes ArrayBuffer
        // setImageBuffer(reader.result as ArrayBuffer); 
      };
      reader.readAsArrayBuffer(singleFile);
    } else {
      setImageFile(undefined);
      // setImageBuffer(null);
    }
  };

  return (
    <div className="w-full bg-gray-800 p-4 sm:p-6 rounded-lg text-white">
      <form onSubmit={handleSubmit} className="space-y-6 w-full">
        <div className="space-y-2 w-full">
          <Label htmlFor="name" className="text-sm font-medium text-gray-300">NAME</Label>
          <Input
            id="name"
            name="name"
            value={formState.name}
            onChange={handleChange}
            required
            className="w-full bg-gray-700 border-gray-600 text-white placeholder-gray-400"
            placeholder="My Awesome Coin"
          />
        </div>

        <div className="space-y-2 w-full">
          <Label htmlFor="symbol" className="text-sm font-medium text-gray-300">SYMBOL</Label>
          <Input
            id="symbol"
            name="symbol"
            value={formState.symbol}
            onChange={handleChange}
            required
            className="w-full bg-gray-700 border-gray-600 text-white placeholder-gray-400"
            placeholder="MAC"
          />
        </div>

        <div className="space-y-2 w-full">
          <Label htmlFor="description" className="text-sm font-medium text-gray-300">DESCRIPTION</Label>
          <Textarea
            id="description"
            name="description"
            value={formState.description}
            onChange={handleChange}
            required
            className="w-full bg-gray-700 border-gray-600 text-white placeholder-gray-400 min-h-[100px]"
            placeholder="A brief description of your coin."
          />
        </div>
        
        <div className="space-y-2 w-full">
          <Label className="text-sm font-medium text-gray-300">LOGO</Label>
          <ImageInput onChange={handleFileChangeInternal} />
        </div>

        <div className="space-y-2 w-full">
          <Label htmlFor="creatorSupply" className="text-sm font-medium text-gray-300">
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
            className="w-full bg-gray-700 border-gray-600 text-white placeholder-gray-400"
          />
           <p className="text-xs text-gray-400">
            Pool will receive: {(TOTAL_SUPPLY - (Number(formState.creatorSupply) || 0)).toLocaleString()} tokens.
          </p>
        </div>

        {errorMessage && (
          <p className="text-sm text-red-500 bg-red-900/30 p-2 rounded-md">{errorMessage}</p>
        )}
        {isPending && (
          <p className="text-sm text-blue-400">Processing transaction...</p>
        )}
        {isSuccess && data && (
           <p className="text-sm text-green-400">Coin launched successfully!</p>
        )}

        <Button type="submit" disabled={isPending || !address} className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-3">
          {isPending ? "Launching..." : "Launch Coin (0.01 ETH)"}
        </Button>
      </form>
    </div>
  );
}
