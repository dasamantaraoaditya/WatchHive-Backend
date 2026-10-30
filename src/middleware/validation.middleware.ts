import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

export const validate = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const errorList = errors.array();
        const firstError = errorList[0];
        const userFriendlyMessage = firstError?.msg || 'Please check the details you entered and try again.';

        res.status(400).json({
            error: userFriendlyMessage,
            message: userFriendlyMessage,
            details: errorList.map((err) => ({
                field: err.type === 'field' ? err.path : undefined,
                message: err.msg,
            })),
        });
        return;
    }

    next();
};
